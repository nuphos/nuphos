// codex-acp's fast-mode option is an on/off switch for the "fast" tier. Codex
// also lists Ultrafast, a separate tier, in a model's serviceTiers. Offer it
// as a third value of the same option, so on/off picks and clients keep working.
// The session's fastModeEnabled now holds the chosen tier, or false.
const SPEEDS =
  'function modelSupportsFast(model) {\n  return model?.additionalSpeedTiers?.includes("fast") ?? false;\n}\nfunction resolveFastServiceTier(fastModeEnabled, currentModelSupportsFast) {\n  return fastModeEnabled && currentModelSupportsFast ? "fast" : null;\n}'
const RESTORED = 'fastModeEnabled: sessionMetadata.currentServiceTier === "fast",'
const PICK =
  '    if (typeof value === "boolean") {\n      sessionState.fastModeEnabled = value;\n      return;\n    }\n    if (value !== FAST_MODE_ON && value !== FAST_MODE_OFF) {\n      throw RequestError.invalidParams();\n    }\n    sessionState.fastModeEnabled = value === FAST_MODE_ON;'
const OPTION_START =
  'function createFastModeConfigOption(fastModeEnabled, useBooleanConfigOption = false) {'
const OPTION_END = '\n\n// src/JBUtils.ts'
const OFFER =
  '        sessionState.fastModeEnabled,\n        this.booleanConfigOptionsSupported\n      ));'

const speeds = `// The tiers a model offers, or false when it offers neither.
function modelSupportsFast(model) {
  const tiers = [
    ...(model?.additionalSpeedTiers ?? []),
    ...(model?.serviceTiers ?? []).map((tier) => tier.id)
  ];
  const speeds = ["fast", "ultrafast"].filter((tier) => tiers.includes(tier));
  return speeds.length > 0 && speeds;
}
function resolveFastServiceTier(fastModeEnabled, currentModelSupportsFast) {
  return currentModelSupportsFast && currentModelSupportsFast.includes(fastModeEnabled) ? fastModeEnabled : null;
}`

const option = `function createFastModeConfigOption(fastModeEnabled, useBooleanConfigOption = false, speeds = ["fast"]) {
  const offered = speeds.includes(fastModeEnabled) && fastModeEnabled;
  if (useBooleanConfigOption) {
    return {
      id: FAST_MODE_CONFIG_ID,
      name: "Fast mode",
      description: FAST_MODE_DESCRIPTION,
      category: FAST_MODE_CATEGORY,
      type: "boolean",
      currentValue: Boolean(offered)
    };
  }
  return {
    id: FAST_MODE_CONFIG_ID,
    name: "Fast mode",
    description: FAST_MODE_DESCRIPTION,
    category: FAST_MODE_CATEGORY,
    type: "select",
    currentValue: offered === "fast" ? FAST_MODE_ON : offered || FAST_MODE_OFF,
    options: [
      {
        value: FAST_MODE_OFF,
        name: "Off",
        description: "Default speed, normal usage"
      },
      ...(speeds.includes("fast") ? [{
        value: FAST_MODE_ON,
        name: "Fast",
        description: FAST_MODE_DESCRIPTION
      }] : []),
      ...(speeds.includes("ultrafast") ? [{
        value: "ultrafast",
        name: "Ultrafast",
        description: "Fastest responses, separate usage limits"
      }] : [])
    ]
  };
}`

const pick = `    if (typeof value === "boolean") {
      sessionState.fastModeEnabled = value && "fast";
      return;
    }
    if (value !== FAST_MODE_ON && value !== FAST_MODE_OFF && value !== "ultrafast") {
      throw RequestError.invalidParams();
    }
    sessionState.fastModeEnabled = value === FAST_MODE_ON ? "fast" : value !== FAST_MODE_OFF && value;`

export function patchCodexUltrafast(source) {
  const start = source.indexOf(OPTION_START)
  const end = source.indexOf(OPTION_END, start)
  if (
    source.split(SPEEDS).length !== 2 ||
    source.split(RESTORED).length !== 3 ||
    source.split(PICK).length !== 2 ||
    source.split(OFFER).length !== 2 ||
    source.split(OPTION_START).length !== 2 ||
    end < 0
  )
    throw new Error('Expected Codex fast mode handoffs')

  return (source.slice(0, start) + option + source.slice(end))
    .replace(SPEEDS, speeds)
    .replaceAll(
      RESTORED,
      'fastModeEnabled: ["fast", "ultrafast"].includes(sessionMetadata.currentServiceTier) && sessionMetadata.currentServiceTier,',
    )
    .replace(PICK, pick)
    .replace(
      OFFER,
      OFFER.replace('\n      ));', ',\n        sessionState.currentModelSupportsFast\n      ));'),
    )
}
