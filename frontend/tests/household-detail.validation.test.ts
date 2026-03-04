import assert from "node:assert/strict";
import test from "node:test";
import { getMissingCarFields } from "../src/app/pages/household-detail.validation";

test("returns no missing fields when hasCar is false", () => {
  const result = getMissingCarFields({
    hasCar: false,
    carModel: "",
    carColor: "",
    carPlate: ""
  });
  assert.deepEqual(result, []);
});

test("returns all missing fields when hasCar is true and fields are empty", () => {
  const result = getMissingCarFields({
    hasCar: true,
    carModel: "",
    carColor: "  ",
    carPlate: ""
  });
  assert.deepEqual(result, ["carModel", "carColor", "carPlate"]);
});

test("returns only missing subset when hasCar is true", () => {
  const result = getMissingCarFields({
    hasCar: true,
    carModel: "Toyota",
    carColor: "",
    carPlate: "LB-1234"
  });
  assert.deepEqual(result, ["carColor"]);
});
