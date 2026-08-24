// Practical unit conversions for construction-hardware quoting — grouped
// into families (length, weight, volume). Each unit's factor is "how many
// of the family's base unit equal 1 of this unit," so converting between
// any two units in the same family is just a ratio of their factors.
// Count-based units (Nos, Bag, Box, etc.) aren't in here on purpose —
// there's nothing to convert, a box is a box.

const UNIT_FAMILIES = {
  length: {
    Meter: 1,
    Mtrs: 1, // alias — matches how real enquiries phrase it (e.g. "15 Mtrs")
    Feet: 0.3048,
    Inch: 0.0254,
    Centimeter: 0.01,
    Millimeter: 0.001,
    Yard: 0.9144,
  },
  weight: {
    Kg: 1,
    Gram: 0.001,
    Lb: 0.453592,
    Ton: 1000,
  },
  volume: {
    Litre: 1,
    Ltrs: 1, // alias — matches real enquiry phrasing (e.g. "200 Ltrs")
    Ml: 0.001,
    Gallon: 3.78541,
  },
}

function normalize(unit) {
  return (unit || '').trim()
}

// Case-insensitive lookup of which family (if any) a unit belongs to.
function findFamily(unit) {
  const target = normalize(unit).toLowerCase()
  for (const [family, units] of Object.entries(UNIT_FAMILIES)) {
    const match = Object.keys(units).find((u) => u.toLowerCase() === target)
    if (match) return { family, canonicalUnit: match }
  }
  return null
}

// Every unit in the same convertible family as the given one — for
// populating the "convert to" dropdown. Returns [] if the unit isn't a
// recognized convertible unit (e.g. "Nos", "Bag") — nothing to convert to.
export function getConvertibleUnits(unit) {
  const found = findFamily(unit)
  if (!found) return []
  return Object.keys(UNIT_FAMILIES[found.family])
}

// Converts a quantity from one unit to another. Returns null if they're
// not in the same convertible family (shouldn't normally be called in
// that case, since the dropdown only offers same-family options, but
// this keeps it safe either way).
export function convertQuantity(quantity, fromUnit, toUnit) {
  const from = findFamily(fromUnit)
  const to = findFamily(toUnit)
  if (!from || !to || from.family !== to.family) return null

  const fromFactor = UNIT_FAMILIES[from.family][from.canonicalUnit]
  const toFactor = UNIT_FAMILIES[to.family][to.canonicalUnit]
  const converted = (Number(quantity) * fromFactor) / toFactor

  // Round to a sensible number of decimals — enough precision for a real
  // quote without ugly floating-point noise like 32.808398950131.
  return Math.round(converted * 1000) / 1000
}
