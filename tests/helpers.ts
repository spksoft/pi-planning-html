import type { PlanDraft } from "../extensions/planning/schema.ts";

const evidenceId = "EVID-auth-boundary";
const requirementId = "REQ-passkey-sign-in";
const acceptanceId = "AC-passkey-session";
const decisionId = "DEC-reuse-session-service";

function observed(path: string) {
  return { path, status: "observed" as const, evidenceId };
}

export function validDraft(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return {
    title: "Add passkey authentication",
    slug: "add-passkey-authentication",
    language: "en",
    summary:
      "Extend the established authentication boundary so passkeys reuse existing session issuance rather than create a parallel identity flow.",
    outcome:
      "Registered users can sign in with passkeys and receive the existing session cookie while password sessions and recovery behavior continue unchanged.",
    repositoryEvidence: [
      {
        id: evidenceId,
        claim:
          "The authentication service owns credential verification and session issuance.",
        sourceType: "repo",
        source: "src/auth/service.ts:AuthService.createSession",
        seams: [
          "src/auth/types.ts",
          "src/auth/service.ts",
          "src/auth/routes.ts",
          "tests/auth/routes.test.ts",
        ],
        confidence: "high",
        notes:
          "Observed service boundary is reused by the route and existing authentication tests.",
      },
    ],
    requirements: [
      {
        id: requirementId,
        statement:
          "A registered user can submit a supported passkey assertion through the existing sign-in boundary and receive the existing session response.",
        rationale:
          "Passkey authentication must add a credential variant without creating a second session lifecycle.",
        priority: "must",
        evidenceIds: [evidenceId],
      },
    ],
    acceptanceCriteria: [
      {
        id: acceptanceId,
        requirementIds: [requirementId],
        precondition:
          "A registered user has a valid passkey credential and an issued challenge.",
        action:
          "The user submits a valid assertion to the existing sign-in endpoint.",
        outcome:
          "The endpoint issues the existing session cookie and returns the established successful sign-in response.",
        edgeCase:
          "An invalid assertion returns the existing validation error without issuing a session or breaking password recovery.",
        validationIds: ["VAL-unit-contract", "VAL-route", "VAL-e2e"],
      },
    ],
    decisions: [
      {
        id: decisionId,
        context:
          "Passkey verification must fit the current authentication and session ownership boundaries.",
        choice:
          "Extend AuthService credential dispatch and reuse the existing session issuance service.",
        alternatives: [
          "Create a dedicated passkey session flow, rejected because it duplicates cookie and recovery behavior.",
        ],
        rationale:
          "The observed service already owns verification dispatch and session issuance for all credential paths.",
        evidenceIds: [evidenceId],
        consequences:
          "The new credential type shares cookie behavior, response errors, metrics, and recovery handling with password sign-in.",
        reversibility: "moderate",
        affectedModules: [
          "src/auth/types.ts",
          "src/auth/service.ts",
          "src/auth/routes.ts",
        ],
        status: "decided",
      },
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
        evidenceIds: [evidenceId],
      },
    ],
    architecture: {
      summary:
        "The browser sends credentials to the authentication route, which delegates verification and session issuance to the existing service boundary and credential store.",
      nodes: [
        {
          id: "browser",
          label: "Browser",
          kind: "actor",
          responsibility:
            "Collect a passkey assertion and receive the existing session response.",
          taskIds: ["wire-passkey-route"],
        },
        {
          id: "auth-route",
          label: "Authentication route",
          kind: "component",
          responsibility:
            "Validate the request and preserve the established response contract.",
          taskIds: ["wire-passkey-route"],
        },
        {
          id: "auth-service",
          label: "Authentication service",
          kind: "component",
          responsibility:
            "Dispatch credential verification and issue the existing session.",
          taskIds: ["extend-credential-contract", "wire-passkey-route"],
        },
        {
          id: "credential-store",
          label: "Credential persistence",
          kind: "store",
          responsibility:
            "Provide registered passkey credential material to verification.",
          taskIds: ["extend-credential-contract"],
        },
      ],
      edges: [
        { from: "browser", to: "auth-route", label: "submits assertion" },
        {
          from: "auth-route",
          to: "auth-service",
          label: "requests verification",
        },
        {
          from: "auth-service",
          to: "credential-store",
          label: "loads credential",
        },
        {
          from: "auth-service",
          to: "auth-route",
          label: "returns session result",
        },
      ],
    },
    tasks: [
      {
        id: "extend-credential-contract",
        title: "Extend the credential verification contract",
        kind: "implementation",
        expectedBehavior:
          "Credential dispatch accepts a valid assertion while leaving password verification behavior unchanged.",
        parallelSafety:
          "Run before route wiring because the route consumes the new credential request contract.",
        what: "Add a WebAuthn assertion variant to the existing credential request and verification result types.",
        why: "The passkey flow must enter the existing authentication boundary without creating a second session stack.",
        how: "Update the named request types, reuse AuthService verification dispatch, preserve password handling, and cover both variants with focused unit tests.",
        files: [observed("src/auth/types.ts"), observed("src/auth/service.ts")],
        requirementIds: [requirementId],
        acceptanceCriteriaIds: [acceptanceId],
        decisionIds: [decisionId],
        dependsOn: [],
        foundationFor: [],
        validationIds: ["VAL-unit-contract"],
        subtasks: [
          {
            id: "add-assertion-types",
            title: "Add assertion request and result types",
            what: "Define the WebAuthn assertion fields alongside the existing password credential request types.",
            why: "Route and service code need one explicit typed contract for the new credential variant.",
            how: "Add discriminated request and result types, preserve existing password fields, and update exhaustiveness checks at the verification boundary.",
            files: [observed("src/auth/types.ts")],
            validationIds: ["VAL-unit-contract"],
          },
        ],
      },
      {
        id: "wire-passkey-route",
        title: "Wire the passkey sign-in route",
        kind: "implementation",
        expectedBehavior:
          "Valid assertions return the existing session response; invalid assertions never issue a cookie.",
        parallelSafety:
          "Run after credential dispatch because this task calls the new service contract and route fixtures.",
        what: "Accept validated passkey assertions in the sign-in route and return the existing session cookie response.",
        why: "This exposes the approved passkey behavior while preserving the current session contract.",
        how: "Call the extended AuthService method, map verification failures to existing error responses, reuse cookie issuance, and add route success and recovery-failure tests.",
        files: [
          observed("src/auth/routes.ts"),
          observed("tests/auth/routes.test.ts"),
        ],
        requirementIds: [requirementId],
        acceptanceCriteriaIds: [acceptanceId],
        decisionIds: [decisionId],
        dependsOn: ["extend-credential-contract"],
        foundationFor: [],
        validationIds: ["VAL-route", "VAL-e2e"],
        subtasks: [
          {
            id: "cover-passkey-route",
            title: "Cover route success and failure responses",
            what: "Add route cases for a valid assertion, invalid assertion, and password recovery fallback.",
            why: "The route must preserve its existing response and recovery contract for every supported credential path.",
            how: "Reuse existing route fixtures and response assertions, then add passkey-specific fixtures at the service boundary instead of mocking cookies separately.",
            files: [observed("tests/auth/routes.test.ts")],
            validationIds: ["VAL-route"],
          },
        ],
      },
    ],
    validations: [
      {
        id: "VAL-unit-contract",
        level: "unit",
        procedure:
          "Run the focused authentication unit suite after compiling the credential union and verification dispatch.",
        preconditions: ["Authentication test dependencies are installed."],
        expectedEvidence:
          "The suite passes for password and passkey variants, including invalid assertion dispatch.",
        acceptanceCriteriaIds: [acceptanceId],
      },
      {
        id: "VAL-route",
        level: "integration",
        procedure:
          "Run the authentication route suite with valid and invalid assertion fixtures plus password recovery fallback.",
        preconditions: [
          "Route fixtures can issue an existing session response.",
        ],
        expectedEvidence:
          "The response assertions show the existing cookie on success and no cookie on invalid assertion.",
        acceptanceCriteriaIds: [acceptanceId],
      },
      {
        id: "VAL-e2e",
        level: "e2e",
        procedure:
          "Exercise registration and passkey sign-in end to end in a supported browser against the configured authentication environment.",
        preconditions: ["A supported browser and authenticator are available."],
        expectedEvidence:
          "The browser receives the existing session response and password recovery remains available after an invalid assertion.",
        acceptanceCriteriaIds: [acceptanceId],
      },
    ],
    endToEndValidationIds: ["VAL-e2e"],
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
        id: "ASM-session-validity",
        assumption:
          "Existing session cookies remain valid during the passkey rollout.",
        confidence: "high",
        impactIfFalse:
          "A migration and forced re-authentication flow would be required before deployment.",
        provenance: "repository-evidence",
        resolutionPoint:
          "Confirm session compatibility during pre-rollout integration validation.",
        fallback:
          "Ship behind a capability flag and defer passkey activation until compatibility is restored.",
      },
    ],
    unknowns: [],
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
