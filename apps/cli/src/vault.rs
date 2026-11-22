//! `nuphos vault`: the user's secrets, encrypted on their own devices. Each
//! device holds an X25519 key in the OS credential store. An item is sealed
//! with a random AES-256-GCM key, and that key is wrapped with HPKE (RFC 9180)
//! for every enrolled device, so Nuphos keeps only ciphertext.

use std::io::{IsTerminal, Read, Write};

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{anyhow, bail, Context, Result};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use hpke::aead::AesGcm256;
use hpke::kdf::HkdfSha256;
use hpke::kem::X25519HkdfSha256;
use hpke::{Deserializable, Kem, OpModeR, OpModeS, Serializable};
use rand::rngs::OsRng;
use rand::RngCore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::cli::Ctx;
use crate::config;
use crate::render::clean;
use crate::secret;

type PrivateKey = <X25519HkdfSha256 as Kem>::PrivateKey;
type PublicKey = <X25519HkdfSha256 as Kem>::PublicKey;

const SERVICE: &str = "ai.nuphos.vault.device";
const WRAP_INFO: &[u8] = b"nuphos-vault/v1 item-key";
const ITEM_AAD: &str = "nuphos-vault/v1 item:";
/// An item is a secret, not a file.
const MAX_VALUE: usize = 64 * 1024;

/// This device's enrollment: its id at Nuphos and its private key.
struct Device {
    id: String,
    key: PrivateKey,
}

/// The credential store, or a 0600 file beside `cli.yaml` without one.
/// `user` comes from the backend, so it must stay one plain file name.
fn device_file(user: &str) -> Result<std::path::PathBuf> {
    if user.is_empty() || !user.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        bail!("Nuphos returned an unexpected user id");
    }
    Ok(config::session_path().with_file_name(format!("vault-{user}.json")))
}

fn load_device(user: &str) -> Result<Option<Device>> {
    let text = if secret::enabled() {
        secret::imp::get(SERVICE, user)?
    } else {
        std::fs::read_to_string(device_file(user)?).ok()
    };
    let Some(text) = text else { return Ok(None) };
    let saved: Value = serde_json::from_str(&text).context("reading this device's vault key")?;
    let key = B64.decode(saved["privateKey"].as_str().unwrap_or_default())?;
    let key = PrivateKey::from_bytes(&key).map_err(|_| anyhow!("this device's vault key is damaged"))?;
    Ok(Some(Device { id: saved["deviceId"].as_str().unwrap_or_default().to_string(), key }))
}

fn save_device(user: &str, device: &Device) -> Result<()> {
    let text = json!({ "deviceId": device.id, "privateKey": B64.encode(device.key.to_bytes()) }).to_string();
    if secret::enabled() {
        secret::imp::set(SERVICE, user, &text)
    } else {
        config::write_private(&device_file(user)?, text.as_bytes())
    }
}

fn forget_device(user: &str) -> Result<()> {
    if secret::enabled() {
        secret::imp::delete(SERVICE, user)
    } else {
        match std::fs::remove_file(device_file(user)?) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    }
}

fn enrolled_device(ctx: &Ctx) -> Result<Device> {
    load_device(&ctx.me_id)?.ok_or_else(|| anyhow!("this device is not in your vault: run `nuphos vault enroll`"))
}

/// What a person compares on both screens before approving a device.
pub(crate) fn fingerprint(public_key: &[u8]) -> String {
    let digest = Sha256::digest(public_key);
    digest[..10].chunks(2).map(|pair| format!("{:02X}{:02X}", pair[0], pair[1])).collect::<Vec<_>>().join("-")
}

fn public_key_of(device: &Value) -> Result<PublicKey> {
    let bytes = B64.decode(device["publicKey"].as_str().unwrap_or_default())?;
    PublicKey::from_bytes(&bytes).map_err(|_| anyhow!("device {} has an invalid public key", device["id"]))
}

/// Wraps an item key for one device; the item name is bound as associated data.
pub(crate) fn wrap(item_key: &[u8], name: &str, to: &PublicKey) -> Result<String> {
    let (encapped, sealed) = hpke::single_shot_seal::<AesGcm256, HkdfSha256, X25519HkdfSha256, _>(
        &OpModeS::Base,
        to,
        WRAP_INFO,
        item_key,
        name.as_bytes(),
        &mut OsRng,
    )
    .map_err(|e| anyhow!("wrapping the item key: {e}"))?;
    Ok(B64.encode([encapped.to_bytes().as_slice(), &sealed].concat()))
}

pub(crate) fn unwrap(wrapped: &str, name: &str, key: &PrivateKey) -> Result<Vec<u8>> {
    let bytes = B64.decode(wrapped)?;
    let split = <X25519HkdfSha256 as Kem>::EncappedKey::size();
    if bytes.len() <= split {
        bail!("the wrapped key of {} is too short", clean(name));
    }
    let encapped = <X25519HkdfSha256 as Kem>::EncappedKey::from_bytes(&bytes[..split])
        .map_err(|_| anyhow!("the wrapped key of {} is damaged", clean(name)))?;
    hpke::single_shot_open::<AesGcm256, HkdfSha256, X25519HkdfSha256>(
        &OpModeR::Base,
        key,
        &encapped,
        WRAP_INFO,
        &bytes[split..],
        name.as_bytes(),
    )
    .map_err(|_| anyhow!("this device cannot open the key of {}", clean(name)))
}

pub(crate) fn seal(item_key: &[u8], name: &str, value: &[u8]) -> Result<String> {
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let aad = format!("{ITEM_AAD}{name}");
    let sealed = Aes256Gcm::new_from_slice(item_key)?
        .encrypt(Nonce::from_slice(&nonce), Payload { msg: value, aad: aad.as_bytes() })
        .map_err(|_| anyhow!("encrypting {}", clean(name)))?;
    Ok(B64.encode([nonce.as_slice(), &sealed].concat()))
}

pub(crate) fn open(item_key: &[u8], name: &str, ciphertext: &str) -> Result<Vec<u8>> {
    let bytes = B64.decode(ciphertext)?;
    if bytes.len() < 12 {
        bail!("the ciphertext of {} is too short", clean(name));
    }
    let aad = format!("{ITEM_AAD}{name}");
    Aes256Gcm::new_from_slice(item_key)?
        .decrypt(Nonce::from_slice(&bytes[..12]), Payload { msg: &bytes[12..], aad: aad.as_bytes() })
        .map_err(|_| anyhow!("{} does not decrypt: it was changed or sealed for another name", clean(name)))
}

/// The backend's rule, checked here so a name never changes the URL path.
pub(crate) fn check_name(name: &str) -> Result<&str> {
    let mut chars = name.chars();
    let first = chars.next().is_some_and(|c| c.is_ascii_alphanumeric());
    if !first || name.len() > 128 || !chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')) {
        bail!("an item name is up to 128 letters, digits, `.`, `_` or `-`, starting with a letter or digit");
    }
    Ok(name)
}

/// The item's key, unwrapped with this device's key.
fn item_key(item: &Value, name: &str, device: &Device) -> Result<Vec<u8>> {
    let keys = item["keys"].as_array().cloned().unwrap_or_default();
    let mine = keys
        .iter()
        .find(|k| k["deviceId"].as_str() == Some(device.id.as_str()))
        .ok_or_else(|| anyhow!("{} has no key for this device; is it approved?", clean(name)))?;
    unwrap(mine["wrapped"].as_str().unwrap_or_default(), name, &device.key)
}

fn hostname() -> String {
    std::env::var("HOSTNAME")
        .ok()
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok())
        .map(|h| h.trim().to_string())
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| "this device".to_string())
}

/// `nuphos vault enroll`: add this device. The first device is trusted on
/// first use; any later one waits for an enrolled device to approve it.
pub async fn enroll(ctx: &Ctx, name: Option<String>) -> Result<()> {
    let devices = ctx.api.vault_devices().await?;
    if let Some(device) = load_device(&ctx.me_id)? {
        if let Some(known) = devices.iter().find(|d| d["id"].as_str() == Some(device.id.as_str())) {
            return print_enrolled(ctx, known, &X25519HkdfSha256::sk_to_pk(&device.key));
        }
        // Removed from the vault elsewhere: start over with a new key.
        forget_device(&ctx.me_id)?;
    }
    let (key, public) = X25519HkdfSha256::gen_keypair(&mut OsRng);
    let added = ctx.api.vault_add_device(&name.unwrap_or_else(hostname), &B64.encode(public.to_bytes())).await?;
    let id = added["id"].as_str().ok_or_else(|| anyhow!("Nuphos did not return a device id"))?.to_string();
    save_device(&ctx.me_id, &Device { id, key })?;
    print_enrolled(ctx, &added, &public)
}

/// The fingerprint comes from the key this device holds, never from what the
/// backend returned, so a swapped key cannot show a matching fingerprint.
fn print_enrolled(ctx: &Ctx, device: &Value, public: &PublicKey) -> Result<()> {
    if ctx.json {
        ctx.print_json(device);
        return Ok(());
    }
    let print = fingerprint(&public.to_bytes());
    let id = device["id"].as_str().unwrap_or_default();
    if device["state"] == "enrolled" {
        println!("This device is in your vault ({id}).");
    } else {
        println!("This device waits for approval. On a device already in your vault, run:");
        println!("  nuphos vault approve {id}");
        println!("and check that it shows the fingerprint {print}.");
    }
    Ok(())
}

/// `nuphos vault devices`
pub async fn devices(ctx: &Ctx) -> Result<()> {
    let devices = ctx.api.vault_devices().await?;
    if ctx.json {
        ctx.print_json(&Value::Array(devices));
        return Ok(());
    }
    let mine = load_device(&ctx.me_id)?.map(|d| d.id);
    if devices.is_empty() {
        println!("No devices: run `nuphos vault enroll`.");
    }
    for d in &devices {
        let id = d["id"].as_str().unwrap_or_default();
        let print = fingerprint(&B64.decode(d["publicKey"].as_str().unwrap_or_default())?);
        crate::cli::row(
            mine.as_deref() == Some(id),
            &[id, d["state"].as_str().unwrap_or_default(), &print, d["name"].as_str().unwrap_or_default()],
        );
    }
    Ok(())
}

/// `nuphos vault approve DEVICE`: wraps every item's key for a pending device
/// once the person confirms its fingerprint matches the one it showed.
pub async fn approve(ctx: &Ctx, wanted: &str, yes: bool) -> Result<()> {
    let device = enrolled_device(ctx)?;
    let devices = ctx.api.vault_devices().await?;
    let target = devices
        .iter()
        .find(|d| d["id"].as_str() == Some(wanted))
        .ok_or_else(|| anyhow!("no device {} in your vault", clean(wanted)))?;
    if target["state"] != "pending" {
        bail!("{} is already enrolled", clean(wanted));
    }
    let public = public_key_of(target)?;
    let print = fingerprint(&public.to_bytes());
    if !yes {
        if !std::io::stdin().is_terminal() {
            bail!("confirm the fingerprint from a terminal, or pass --yes");
        }
        eprint!(
            "Approve {} with fingerprint {print}? It will read every item in your vault. [y/N] ",
            clean(target["name"].as_str().unwrap_or_default())
        );
        std::io::stderr().flush()?;
        let mut answer = String::new();
        std::io::stdin().read_line(&mut answer)?;
        if !matches!(answer.trim(), "y" | "Y" | "yes") {
            bail!("not approved");
        }
    }
    let mut keys = Vec::new();
    for listed in ctx.api.vault_items().await? {
        let name = listed["name"].as_str().unwrap_or_default();
        let item = ctx.api.vault_item(name).await?;
        keys.push(json!({ "name": name, "wrapped": wrap(&item_key(&item, name, &device)?, name, &public)? }));
    }
    let approved = ctx.api.vault_approve_device(wanted, &keys).await?;
    if ctx.json {
        ctx.print_json(&approved);
    } else {
        println!("Approved {} with {} item(s).", clean(wanted), keys.len());
    }
    Ok(())
}

/// `nuphos vault remove-device DEVICE`. Items are not re-keyed: a removed
/// device that kept a copy of a key can still open that copy.
pub async fn remove_device(ctx: &Ctx, wanted: &str) -> Result<()> {
    ctx.api.vault_remove_device(wanted).await?;
    if load_device(&ctx.me_id)?.is_some_and(|d| d.id == wanted) {
        forget_device(&ctx.me_id)?;
    }
    if !ctx.json {
        println!("Removed {} from your vault.", clean(wanted));
    }
    Ok(())
}

/// `nuphos vault set NAME`: the value comes from stdin, so it stays out of
/// the shell history.
pub async fn set(ctx: &Ctx, name: &str) -> Result<()> {
    let name = check_name(name)?;
    enrolled_device(ctx)?;
    let mut value = Vec::new();
    std::io::stdin().take(MAX_VALUE as u64 + 1).read_to_end(&mut value)?;
    if value.len() > MAX_VALUE {
        bail!("a vault item holds at most {} KiB", MAX_VALUE / 1024);
    }
    let mut item_key = [0u8; 32];
    OsRng.fill_bytes(&mut item_key);
    let mut keys = Vec::new();
    for d in ctx.api.vault_devices().await?.iter().filter(|d| d["state"] == "enrolled") {
        keys.push(json!({ "deviceId": d["id"], "wrapped": wrap(&item_key, name, &public_key_of(d)?)? }));
    }
    let ciphertext = seal(&item_key, name, &value)?;
    ctx.api.vault_put_item(name, &ciphertext, &keys).await?;
    if !ctx.json {
        println!("Saved {} for {} device(s).", clean(name), keys.len());
    }
    Ok(())
}

/// `nuphos vault get NAME`: prints the value as it was stored.
pub async fn get(ctx: &Ctx, name: &str) -> Result<()> {
    let name = check_name(name)?;
    let device = enrolled_device(ctx)?;
    let item = ctx.api.vault_item(name).await?;
    let value = open(&item_key(&item, name, &device)?, name, item["ciphertext"].as_str().unwrap_or_default())?;
    std::io::stdout().write_all(&value)?;
    Ok(())
}

/// `nuphos vault list`
pub async fn list(ctx: &Ctx) -> Result<()> {
    let items = ctx.api.vault_items().await?;
    if ctx.json {
        ctx.print_json(&Value::Array(items));
        return Ok(());
    }
    if items.is_empty() {
        println!("Your vault is empty.");
    }
    for item in &items {
        crate::cli::row(
            false,
            &[item["name"].as_str().unwrap_or_default(), item["updatedAt"].as_str().unwrap_or_default()],
        );
    }
    Ok(())
}

/// `nuphos vault rm NAME`
pub async fn remove(ctx: &Ctx, name: &str) -> Result<()> {
    let name = check_name(name)?;
    ctx.api.vault_delete_item(name).await?;
    if !ctx.json {
        println!("Deleted {}.", clean(name));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_item_round_trips_through_a_wrapped_key() {
        let (key, public) = X25519HkdfSha256::gen_keypair(&mut OsRng);
        let item_key = [7u8; 32];
        let wrapped = wrap(&item_key, "github-token", &public).unwrap();
        assert_eq!(unwrap(&wrapped, "github-token", &key).unwrap(), item_key);
        let sealed = seal(&item_key, "github-token", b"ghp_example").unwrap();
        assert_eq!(open(&item_key, "github-token", &sealed).unwrap(), b"ghp_example");
    }

    /// Made by Desktop (`apps/desktop/electron/vault/crypto.ts`) for the
    /// private key 0x11 x 32 and the item key 0x22 x 32.
    #[test]
    fn opens_what_desktop_wrapped_and_sealed() {
        let key = PrivateKey::from_bytes(&[0x11u8; 32]).unwrap();
        let wrapped = "t+xL8fwNZ2wtS3K9/3xHowoAHbiQwAQFhMjYuZ2NLQ3wLbnSZj2UqvcrDYKMbFJma6Lg//iSmYiAcVHFc6L2NAcrITpAnRFkWeIXaB2cn7Q=";
        let item_key = unwrap(wrapped, "github-token", &key).unwrap();
        assert_eq!(item_key, [0x22u8; 32]);
        let sealed = "ydWnj73hmkELeBsotFkEkxEQcIkvwyxYro/Md9+mMlIbMvZSHuXi";
        assert_eq!(open(&item_key, "github-token", sealed).unwrap(), b"ghp_example");
    }

    #[test]
    fn a_key_or_ciphertext_moved_to_another_name_does_not_open() {
        let (key, public) = X25519HkdfSha256::gen_keypair(&mut OsRng);
        let item_key = [7u8; 32];
        assert!(unwrap(&wrap(&item_key, "a", &public).unwrap(), "b", &key).is_err());
        assert!(open(&item_key, "b", &seal(&item_key, "a", b"v").unwrap()).is_err());
    }

    #[test]
    fn another_device_cannot_unwrap() {
        let (_, public) = X25519HkdfSha256::gen_keypair(&mut OsRng);
        let (other, _) = X25519HkdfSha256::gen_keypair(&mut OsRng);
        assert!(unwrap(&wrap(&[1u8; 32], "a", &public).unwrap(), "a", &other).is_err());
    }

    #[test]
    fn a_name_cannot_leave_its_path_segment() {
        assert!(check_name("github.token-2").is_ok());
        for bad in ["", ".", "..", "-x", "a/b", "a b", &"a".repeat(129)] {
            assert!(check_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_fingerprint_is_five_groups_of_hex() {
        let print = fingerprint(&[0u8; 32]);
        assert_eq!(print.len(), 24);
        assert_eq!(print.split('-').count(), 5);
    }
}
