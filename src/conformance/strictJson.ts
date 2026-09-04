// src/conformance/strictJson.ts

/** JSON の object member 重複を、JSON.parse 前の生テキストから検査する。 */
export function assertNoDuplicateObjectMembers(text: string): void {
  const parser = new DuplicateMemberParser(text);
  parser.parseDocument();
}

/** JSON の構文を走査し、各 object 内の重複した member name を検出する。 */
class DuplicateMemberParser {
  private index = 0;

  public constructor(private readonly text: string) {}

  public parseDocument(): void {
    this.skipWhitespace();
    this.parseValue();
    this.skipWhitespace();
    this.require(this.index === this.text.length, "JSON contains trailing characters.");
  }

  private parseValue(): void {
    this.skipWhitespace();
    const character = this.text[this.index];
    if (character === "{") {
      this.parseObject();
    } else if (character === "[") {
      this.parseArray();
    } else if (character === '"') {
      this.parseString();
    } else if (character === "-" || this.isDigit(character)) {
      this.parseNumber();
    } else if (this.consumeLiteral("true") || this.consumeLiteral("false") || this.consumeLiteral("null")) {
      return;
    } else {
      this.fail("JSON value is invalid.");
    }
  }

  private parseObject(): void {
    this.expect("{");
    this.skipWhitespace();
    if (this.consume("}")) return;

    const memberNames = new Set<string>();
    while (true) {
      this.skipWhitespace();
      this.require(this.text[this.index] === '"', "JSON object member name is invalid.");
      const name = this.parseString();
      this.require(!memberNames.has(name), `JSON object contains duplicate member: ${name}.`);
      memberNames.add(name);
      this.skipWhitespace();
      this.expect(":");
      this.parseValue();
      this.skipWhitespace();
      if (this.consume("}")) return;
      this.expect(",");
    }
  }

  private parseArray(): void {
    this.expect("[");
    this.skipWhitespace();
    if (this.consume("]")) return;
    while (true) {
      this.parseValue();
      this.skipWhitespace();
      if (this.consume("]")) return;
      this.expect(",");
    }
  }

  private parseString(): string {
    const start = this.index;
    this.expect('"');
    while (this.index < this.text.length) {
      const character = this.text[this.index];
      if (character === '"') {
        this.index += 1;
        return JSON.parse(this.text.slice(start, this.index)) as string;
      }
      if (character !== "\\") {
        this.require(character !== undefined && character.charCodeAt(0) >= 0x20, "JSON string contains a control character.");
        this.index += 1;
        continue;
      }
      this.index += 1;
      const escape = this.text[this.index];
      this.require(escape !== undefined && '"\\/bfnrtu'.includes(escape), "JSON string escape is invalid.");
      this.index += 1;
      if (escape === "u") {
        for (let offset = 0; offset < 4; offset += 1) {
          this.require(this.text[this.index] !== undefined && /^[0-9a-f]$/i.test(this.text[this.index] ?? ""), "JSON unicode escape is invalid.");
          this.index += 1;
        }
      }
    }
    this.fail("JSON string is unterminated.");
  }

  private parseNumber(): void {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(this.text.slice(this.index));
    this.require(match !== null, "JSON number is invalid.");
    this.index += match?.[0].length ?? 0;
  }

  private consumeLiteral(literal: string): boolean {
    if (!this.text.startsWith(literal, this.index)) return false;
    this.index += literal.length;
    return true;
  }

  private consume(character: string): boolean {
    if (this.text[this.index] !== character) return false;
    this.index += 1;
    return true;
  }

  private expect(character: string): void {
    this.require(this.consume(character), `Expected JSON character ${character}.`);
  }

  private skipWhitespace(): void {
    while (this.text[this.index] !== undefined && " \t\r\n".includes(this.text[this.index] ?? "")) this.index += 1;
  }

  private isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= "0" && character <= "9";
  }

  private require(condition: boolean, message: string): asserts condition {
    if (!condition) this.fail(message);
  }

  private fail(message: string): never {
    throw new Error(`${message} (offset ${this.index}).`);
  }
}
