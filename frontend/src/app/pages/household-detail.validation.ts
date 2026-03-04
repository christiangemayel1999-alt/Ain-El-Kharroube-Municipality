export function getMissingCarFields(input: {
  hasCar: boolean;
  carModel?: string | null;
  carColor?: string | null;
  carPlate?: string | null;
}) {
  if (!input.hasCar) {
    return [] as Array<"carModel" | "carColor" | "carPlate">;
  }

  const missing: Array<"carModel" | "carColor" | "carPlate"> = [];
  if (!String(input.carModel ?? "").trim()) {
    missing.push("carModel");
  }
  if (!String(input.carColor ?? "").trim()) {
    missing.push("carColor");
  }
  if (!String(input.carPlate ?? "").trim()) {
    missing.push("carPlate");
  }
  return missing;
}
