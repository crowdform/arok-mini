import { v5 as uuidv5 } from "uuid";

const NAMESPACE = "AROK.VC";
export type UUID = `${string}-${string}-${string}-${string}-${string}`;

export function stringToUuid(inputString: string): UUID {
  return uuidv5(inputString, NAMESPACE) as UUID;
}
