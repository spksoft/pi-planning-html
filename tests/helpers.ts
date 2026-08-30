import type { PlanDraft } from "../extensions/planning/schema.ts";

export function validDraft(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return {
    title: "Add passkey authentication",
    slug: "add-passkey-authentication",
    summary:
      "Extend the established authentication boundary so passkeys reuse existing session issuance rather than create a parallel identity flow.",
    outcome:
      "Registered users can sign in with passkeys while password sessions and recovery behavior continue to work unchanged.",
    acceptanceCriteria: [
      "A registered user can complete passkey sign-in and receive the existing session cookie.",
    ],
    inScope: [
      "Passkey registration and sign-in through the existing authentication boundary.",
    ],
    outOfScope: [
      "Removing password authentication or invalidating current sessions.",
    ],
    constraints: [
      "Reuse the existing session issuance service and error response contract.",
    ],
    findings: [
      {
        summary: "The authentication service already owns session issuance.",
        evidence: ["src/auth/service.ts:AuthService.createSession"],
      },
    ],
    architecture: {
      summary:
        "The browser sends credentials to the authentication route, which delegates verification and session issuance to the existing service boundary.",
      diagram: `flowchart LR
  Browser[Browser] --> Route[Authentication route]
  Route --> Service[Authentication service]
  Service --> Session[Session issuance]`,
    },
    tasks: [
      {
        id: "extend-credential-contract",
        title: "Extend the credential verification contract",
        what: "Add a WebAuthn assertion variant to the existing credential request and verification result types.",
        why: "The passkey flow must enter the existing authentication boundary without creating a second session stack.",
        how: "Update the named request types, reuse AuthService verification dispatch, preserve password handling, and cover both variants with focused unit tests.",
        files: ["src/auth/types.ts", "src/auth/service.ts"],
        dependsOn: [],
        validation: [
          "Run focused authentication unit tests and confirm both credential variants pass.",
        ],
        subtasks: [
          {
            id: "add-assertion-types",
            title: "Add assertion request and result types",
            what: "Define the WebAuthn assertion fields alongside the existing password credential request types.",
            why: "Route and service code need one explicit, typed contract for the new credential variant.",
            how: "Add discriminated request and result types, preserve existing password fields, and update exhaustiveness checks at the verification boundary.",
            files: ["src/auth/types.ts"],
            dependsOn: ["extend-credential-contract"],
            validation: [
              "Run TypeScript type checking and focused contract unit tests for both credential variants.",
            ],
          },
        ],
      },
      {
        id: "wire-passkey-route",
        title: "Wire the passkey sign-in route",
        what: "Accept validated passkey assertions in the sign-in route and return the existing session cookie response.",
        why: "This exposes the approved passkey behavior while preserving the current session contract.",
        how: "Call the extended AuthService method, map verification failures to existing error responses, reuse cookie issuance, and add route success and recovery-failure tests.",
        files: ["src/auth/routes.ts", "tests/auth/routes.test.ts"],
        dependsOn: ["extend-credential-contract"],
        validation: [
          "Run route tests and manually verify success, invalid assertion, and recovery fallback behavior.",
        ],
        subtasks: [
          {
            id: "cover-passkey-route",
            title: "Cover route success and failure responses",
            what: "Add route cases for a valid assertion, invalid assertion, and password recovery fallback.",
            why: "The route must preserve its existing response and recovery contract for every supported credential path.",
            how: "Reuse existing route fixtures and response assertions, then add passkey-specific fixtures at the service boundary instead of mocking cookies separately.",
            files: ["tests/auth/routes.test.ts"],
            dependsOn: ["wire-passkey-route"],
            validation: [
              "Run the focused route suite and verify cookie, validation error, and recovery responses.",
            ],
          },
        ],
      },
    ],
    validation: [
      "Run authentication unit and route suites, then exercise registration and sign-in end to end in a supported browser.",
    ],
    risks: [
      {
        risk: "Browser or authenticator differences may produce incompatible assertion data.",
        severity: "medium",
        mitigation:
          "Validate against the selected adapter and cover supported browser fixtures before rollout.",
      },
    ],
    assumptions: [
      {
        assumption:
          "Existing session cookies remain valid during the passkey rollout.",
        confidence: "high",
        impactIfFalse:
          "A migration and forced re-authentication flow would be required before deployment.",
      },
    ],
    openQuestions: [],
    engineering: [
      {
        area: "architecture",
        assessment:
          "Extend the existing authentication boundary and credential adapter instead of introducing a parallel session service.",
      },
      {
        area: "security",
        assessment:
          "Validate assertion origin, challenge, and replay protection in the existing trusted verification adapter.",
      },
      {
        area: "data-and-migrations",
        assessment:
          "No destructive migration is expected; store passkey credentials through the established credential persistence abstraction.",
      },
      {
        area: "testing",
        assessment:
          "Cover type, service, route, and browser-level flows with supported authenticator fixtures and existing recovery cases.",
      },
      {
        area: "rollout-and-rollback",
        assessment:
          "Release behind a capability flag and disable the passkey path without changing password authentication if verification failures rise.",
      },
      {
        area: "observability",
        assessment:
          "Record passkey verification success, rejection reason, and fallback usage through the existing authentication metrics path.",
      },
      {
        area: "performance-and-accessibility",
        assessment:
          "Keep the sign-in form keyboard accessible and measure added verification latency against the current sign-in service budget.",
      },
    ],
    ...overrides,
  };
}
