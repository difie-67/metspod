const TON_DECIMALS = 9;

export function parseTonAmount(input: string): bigint {
  const normalized = input.trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error("Введите положительное число без экспоненты");
  }

  const decimals = TON_DECIMALS;
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) {
    throw new Error(`TON поддерживает не более ${decimals} знаков после запятой`);
  }

  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
  if (units <= 0n) throw new Error("Сумма должна быть больше нуля");
  return units;
}

export function formatTonAmount(unitsRaw: string | bigint): string {
  const units = typeof unitsRaw === "bigint" ? unitsRaw : BigInt(unitsRaw);
  const decimals = TON_DECIMALS;
  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  const fraction = (units % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
