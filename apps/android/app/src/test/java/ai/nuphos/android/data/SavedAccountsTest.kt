package ai.nuphos.android.data

import ai.nuphos.android.model.NuphosUser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SavedAccountsTest {
    private val cloud = "https://api.nuphos.ai"
    private val selfHosted = "https://nuphos.example.com"
    private val ada = NuphosUser("u1", email = "ada@example.com", name = "Ada")
    private val bob = NuphosUser("u2", email = "bob@example.com", name = "Bob")

    @Test fun addsAccountsAndRefreshesTheSameOne() {
        var accounts = SavedAccounts.remember(emptyList(), cloud, ada, "t1")
        accounts = SavedAccounts.remember(accounts, cloud, bob, "t2")
        accounts = SavedAccounts.remember(accounts, cloud, ada.copy(name = "Ada L"), "t3")
        assertEquals(listOf("u1", "u2"), accounts.map { it.user.id })
        assertEquals("Ada L", accounts[0].user.name)
        assertEquals("t3", accounts[0].token)
    }

    @Test fun sameUserOnAnotherServerIsAnotherAccount() {
        val accounts = SavedAccounts.remember(SavedAccounts.remember(emptyList(), cloud, ada, "t1"), selfHosted, ada, "t2")
        assertEquals(2, accounts.size)
        assertEquals(setOf("$cloud|u1", "$selfHosted|u1"), accounts.map { it.id }.toSet())
    }

    @Test fun aTokenBelongsToOneAccountOnly() {
        val accounts = SavedAccounts.remember(SavedAccounts.remember(emptyList(), cloud, ada, "t1"), cloud, bob, "t1")
        assertNull(accounts.single { it.user.id == "u1" }.token)
        assertEquals("t1", accounts.single { it.user.id == "u2" }.token)
    }

    @Test fun expiryKeepsTheAccountListedAndForgetRemovesOnlyIt() {
        var accounts = SavedAccounts.remember(SavedAccounts.remember(emptyList(), cloud, ada, "t1"), cloud, bob, "t2")
        accounts = SavedAccounts.expire(accounts, "t1")
        assertNull(accounts[0].token)
        assertEquals("t2", accounts[1].token)
        accounts = SavedAccounts.forget(accounts, "$cloud|u2")
        assertEquals(listOf("u1"), accounts.map { it.user.id })
    }

    @Test fun rejectedSignOutKeepsTheAccountToSignInAgain() {
        val accounts = SavedAccounts.remember(SavedAccounts.remember(emptyList(), cloud, ada, "t1"), cloud, bob, "t2")
        val rejected = SavedAccounts.signedOut(accounts, "t1", rejected = true)
        assertEquals(listOf("u1", "u2"), rejected.map { it.user.id })
        assertNull(rejected[0].token)
        assertEquals("t2", rejected[1].token)
        assertEquals(listOf("u2"), SavedAccounts.signedOut(accounts, "t1", rejected = false).map { it.user.id })
    }

    @Test fun withoutEncryptionOnlyTheCurrentTokenIsKept() {
        val accounts = SavedAccounts.remember(SavedAccounts.remember(emptyList(), cloud, ada, "t1"), cloud, bob, "t2")
        val kept = SavedAccounts.onlyCurrent(accounts, "t2")
        assertEquals(listOf("u1", "u2"), kept.map { it.user.id })
        assertNull(kept[0].token)
        assertEquals("t2", kept[1].token)
        assertTrue(SavedAccounts.onlyCurrent(accounts, null).all { it.token == null })
    }

    @Test fun roundTripsAndTreatsUnreadableDataAsEmpty() {
        val accounts = SavedAccounts.remember(emptyList(), cloud, ada, "t1")
        assertEquals(accounts, SavedAccounts.decode(SavedAccounts.encode(accounts)))
        assertTrue(SavedAccounts.decode(null).isEmpty())
        assertTrue(SavedAccounts.decode("not json").isEmpty())
    }
}
