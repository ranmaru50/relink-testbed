// src/server/entity/fixtures.ts

/** AR-XML fixture bodies mapped explicitly to URL paths. */
export const arxmlFixtures: Readonly<Record<string, string>> = {
  "/arxml/valid/single-output-json.arxml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><arxml><capability id=\"temperature\" type=\"sensor\"><endpoint>/api/json/single</endpoint><output name=\"temperature\" representation=\"application/json\"/></capability></arxml>",
  "/arxml/valid/multi-output-json.arxml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><arxml><capability id=\"climate\" type=\"sensor\"><endpoint>/api/json/multi</endpoint><output name=\"temperature\"/><output name=\"humidity\"/></capability></arxml>",
  "/arxml/valid/text-output.arxml": "<?xml version=\"1.0\"?><arxml><capability id=\"text\" type=\"value\"><endpoint>/api/text</endpoint></capability></arxml>",
  "/arxml/valid/binary-output.arxml": "<?xml version=\"1.0\"?><arxml><capability id=\"binary\" type=\"value\"><endpoint>/api/binary</endpoint></capability></arxml>",
  "/arxml/valid/post-json.arxml": "<?xml version=\"1.0\"?><arxml><capability id=\"echo\" type=\"action\"><endpoint>/api/json/echo</endpoint></capability></arxml>",
  "/arxml/valid/no-output-204.arxml": "<?xml version=\"1.0\"?><arxml><capability id=\"empty\" type=\"action\"><endpoint>/api/no-content</endpoint></capability></arxml>",
  "/arxml/invalid/malformed-xml.arxml": "<arxml><capability",
  "/arxml/invalid/missing-capability-id.arxml": "<arxml><capability type=\"sensor\"/></arxml>",
  "/arxml/invalid/missing-capability-type.arxml": "<arxml><capability id=\"a\"/></arxml>",
  "/arxml/invalid/duplicate-capability-id.arxml": "<arxml><capability id=\"a\" type=\"x\"/><capability id=\"a\" type=\"x\"/></arxml>",
  "/arxml/invalid/duplicate-output-name.arxml": "<arxml><capability id=\"a\" type=\"x\"><output name=\"v\"/><output name=\"v\"/></capability></arxml>",
  "/arxml/invalid/invalid-namespace.arxml": "<arxml xmlns=\"urn:invalid\"><capability id=\"a\" type=\"x\"/></arxml>",
  "/arxml/edge/unresolved-contract.arxml": "<arxml><capability id=\"a\" type=\"x\" contract=\"missing\"/></arxml>",
  "/arxml/edge/relative-endpoint.arxml": "<arxml><capability id=\"relative\" type=\"x\"><endpoint>api/json/single</endpoint></capability></arxml>",
  "/arxml/edge/root-relative-endpoint.arxml": "<arxml><capability id=\"root\" type=\"x\"><endpoint>/api/json/single</endpoint></capability></arxml>",
  "/arxml/edge/parent-relative-endpoint.arxml": "<arxml><capability id=\"parent\" type=\"x\"><endpoint>../api/json/single</endpoint></capability></arxml>"
};
