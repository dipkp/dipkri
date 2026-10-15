import fs from "node:fs";
import { resolveShard } from "./resolveShard.ts";

let adjectives = fs
  .readFileSync(process.cwd() + "/words/adjectives.txt")
  .toString()
  .split(/\r?\n/);
const nouns = fs
  .readFileSync(process.cwd() + "/words/nouns.txt")
  .toString()
  .split(/\r?\n/);
const verbs = fs
  .readFileSync(process.cwd() + "/words/verbs.txt")
  .toString()
  .split(/\r?\n/);
const randomElement = (array: string[]) =>
  array[Math.floor(Math.random() * array.length)];

export function makeRoomName(_shard?: number | undefined) {
  // Generate a clean 6-digit numeric room code (e.g. 748291)
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  return code;
}

export function makeUserName() {
  return `${capFirst(randomElement(adjectives))} ${capFirst(
    randomElement(nouns),
  )}`;
}

function capFirst(string: string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}
