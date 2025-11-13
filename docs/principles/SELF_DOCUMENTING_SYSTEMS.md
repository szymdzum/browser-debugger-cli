# Self-Documenting Systems for Autonomous Agents

> **How tools can teach agents to use them without external documentation**

## Table of Contents

- [The Problem: Documentation Debt](#the-problem-documentation-debt)
- [Core Principle: Tools as Teachers](#core-principle-tools-as-teachers)
- [Three Pillars of Self-Documentation](#three-pillars-of-self-documentation)
- [The Discovery Hierarchy](#the-discovery-hierarchy)
- [Implementation Patterns](#implementation-patterns)
- [Anti-Patterns](#anti-patterns)
- [Case Study: bdg's CDP Introspection](#case-study-bdgs-cdp-introspection)
- [Measuring Success](#measuring-success)
- [Related Concepts](#related-concepts)

## The Problem: Documentation Debt

### Traditional Approach: External Documentation

Most CLI tools follow this pattern:

```
Tool → README → API Docs → Examples → Stack Overflow → Agent Learns
   ↑                                                         ↓
   └─────────────────── Agent Uses Tool ────────────────────┘
```

**Problems:**

1. **Documentation Drift**: Docs become stale as tool evolves
2. **Context Window Tax**: Agents must consume large docs before using tool
3. **Discovery Friction**: Agents must know what questions to ask
4. **No Runtime Validation**: Docs can't verify agent understanding
5. **External Dependencies**: Requires web access, breaking offline workflows

### The Self-Documenting Approach

```
Tool ←→ Agent
 ↓       ↑
 └───────┘
  (Direct Dialogue)
```

**Benefits:**

1. **Zero Documentation Drift**: Tool IS the documentation
2. **Progressive Disclosure**: Agent learns exactly what it needs, when it needs it
3. **Exploratory Learning**: Agent discovers capabilities through interaction
4. **Runtime Verification**: Tool validates agent understanding immediately
5. **Offline-First**: No external dependencies required

## Core Principle: Tools as Teachers

> **A tool should be able to teach an agent how to use it through conversation alone.**

This requires three capabilities:

1. **Self-Description**: Tool can describe itself (`--help --json`)
2. **Domain Introspection**: Tool can describe what it operates on (CDP protocol)
3. **Example Generation**: Tool provides usage examples for every operation

### The Socratic Method for Tools

Instead of:
```bash
# Agent reads 50-page manual
# Agent tries command
# Agent debugs error
```

Enable:
```bash
# Agent asks: "What can you do?"
bdg --help --json

# Agent asks: "What domains exist?"
bdg cdp --list

# Agent asks: "What can I do with Network?"
bdg cdp Network --list

# Agent asks: "How do I get cookies?"
bdg cdp Network.getCookies --describe

# Agent uses: (with confidence)
bdg cdp Network.getCookies --params '{}'
```

## Three Pillars of Self-Documentation

### 1. Structural Introspection

**Definition**: Tool can describe its own structure programmatically.

**Implementation**:
```bash
$ bdg --help --json
{
  "name": "bdg",
  "version": "0.6.0",
  "commands": [
    {
      "name": "cdp",
      "description": "Execute CDP commands",
      "options": [
        {"name": "--params", "type": "json", "required": false},
        {"name": "--list", "type": "boolean", "required": false}
      ],
      "examples": [
        "bdg cdp --list",
        "bdg cdp Network --list",
        "bdg cdp Runtime.evaluate --params '{\"expression\":\"1+1\"}'"
      ]
    }
  ],
  "exit_codes": {
    "0": "Success",
    "80": "Invalid URL provided",
    "83": "Resource not found"
  }
}
```

**Why It Matters**:
- Agent can parse tool capabilities before first use
- No ambiguity about available commands
- Exit codes enable proper error handling

### 2. Domain Introspection

**Definition**: Tool can describe the domain it operates on (not just itself).

**Example**: bdg exposes the entire Chrome DevTools Protocol:

```bash
# List all 53 CDP domains
$ bdg cdp --list
Accessibility, Animation, Audits, Browser, CSS, ...

# List all methods in Network domain (39 methods)
$ bdg cdp Network --list
canClearBrowserCache, canClearBrowserCookies, ...

# Get full schema for a specific method
$ bdg cdp Network.getCookies --describe
{
  "domain": "Network",
  "method": "getCookies",
  "description": "Returns all browser cookies. Depending on the backend support...",
  "parameters": {
    "urls": {
      "type": "array",
      "items": {"type": "string"},
      "optional": true,
      "description": "The list of URLs for which applicable cookies will be fetched"
    }
  },
  "returns": {
    "cookies": {
      "type": "array",
      "items": {"$ref": "Cookie"},
      "description": "Array of cookie objects."
    }
  },
  "examples": [
    "bdg cdp Network.getCookies",
    "bdg cdp Network.getCookies --params '{\"urls\":[\"https://example.com\"]}'"
  ]
}
```

**Why It Matters**:
- Agent learns 300+ CDP methods without external docs
- Agent can explore capabilities autonomously
- Schema validation prevents invalid usage

### 3. Search-Driven Discovery

**Definition**: Tool enables semantic search across its capabilities.

**Implementation**:
```bash
# Agent doesn't know exact method name
$ bdg cdp --search cookie
Found 14 methods matching 'cookie':
  Network.getCookies - Returns all browser cookies
  Network.getAllCookies - Returns all browser cookies for all URLs
  Network.setCookie - Sets a cookie with the given cookie data
  Network.deleteCookies - Deletes browser cookies with matching name
  Storage.getCookies - Returns all browser cookies
  ...

# Agent searches by concept
$ bdg cdp --search "javascript execution"
Found 8 methods matching 'javascript execution':
  Runtime.evaluate - Evaluates expression on global object
  Runtime.callFunctionOn - Calls function with given declaration
  Debugger.evaluateOnCallFrame - Evaluates expression on call frame
  ...
```

**Why It Matters**:
- Agent discovers relevant methods without knowing exact names
- Fuzzy matching handles typos (Levenshtein distance)
- Semantic search maps concepts to methods

## The Discovery Hierarchy

Self-documenting tools follow a natural discovery hierarchy:

```
Level 0: What is this tool?
  ↓ bdg --help --json
Level 1: What can it do?
  ↓ bdg cdp --list
Level 2: What are the categories?
  ↓ bdg cdp Network --list
Level 3: How do I use this specific thing?
  ↓ bdg cdp Network.getCookies --describe
Level 4: Execute with confidence
  ↓ bdg cdp Network.getCookies --params '{}'
```

### Progressive Disclosure

Each level provides:
1. **Just Enough Information**: No overwhelming dumps
2. **Clear Next Steps**: Obvious path to deeper discovery
3. **Executable Examples**: Copy-paste ready commands
4. **Error Prevention**: Schema validation before execution

### Example: Agent Learning Flow

```typescript
// Agent starts with zero knowledge
const tool = "bdg";

// Level 0: Discover tool capabilities
const help = await exec(`${tool} --help --json`);
// Agent learns: 10 commands available, including "cdp"

// Level 1: Discover domain capabilities
const domains = await exec(`${tool} cdp --list`);
// Agent learns: 53 CDP domains available

// Level 2: Discover domain methods
const methods = await exec(`${tool} cdp Network --list`);
// Agent learns: 39 Network methods available

// Level 3: Discover method schema
const schema = await exec(`${tool} cdp Network.getCookies --describe`);
// Agent learns: Method signature, parameters, return type, examples

// Level 4: Execute with confidence
const result = await exec(`${tool} cdp Network.getCookies`);
// Agent successfully retrieves cookies
```

## Implementation Patterns

### Pattern 1: Machine-Readable Help

**Bad** (human-only):
```bash
$ tool --help
Usage: tool [options] <command>

Commands:
  start    Start the thing
  stop     Stop the thing

Options:
  -v, --verbose    Be verbose
  -q, --quiet      Be quiet
```

**Good** (dual-mode):
```bash
$ tool --help --json
{
  "commands": [
    {
      "name": "start",
      "description": "Start the thing",
      "options": [
        {"name": "--timeout", "type": "integer", "default": 30}
      ]
    }
  ]
}
```

**Implementation**:
```typescript
function help(options: { json?: boolean }) {
  if (options.json) {
    return JSON.stringify({
      name: packageJson.name,
      version: packageJson.version,
      commands: getCommandsSchema(),
      exit_codes: EXIT_CODES_SCHEMA,
    });
  }
  return formatHumanHelp();
}
```

### Pattern 2: Domain Schema Exposure

**Bad** (hidden schema):
```bash
# Agent must guess parameter names
$ tool send-request --url X --method Y --headers Z
```

**Good** (exposed schema):
```bash
# Agent discovers schema first
$ tool schema --method send-request
{
  "parameters": {
    "url": {"type": "string", "required": true},
    "method": {"type": "enum", "values": ["GET", "POST"]},
    "headers": {"type": "object", "optional": true}
  }
}

# Then uses with confidence
$ tool send-request --url X --method GET
```

**Implementation**:
```typescript
// Load protocol schema at startup
import { Protocol } from 'devtools-protocol';

function describeMethod(domain: string, method: string) {
  const schema = getProtocolSchema(domain, method);
  return {
    domain,
    method,
    description: schema.description,
    parameters: schema.parameters,
    returns: schema.returns,
    examples: generateExamples(domain, method),
  };
}
```

### Pattern 3: Semantic Search

**Bad** (exact match only):
```bash
$ tool find "getCookie"
Error: Method not found
# Agent gives up
```

**Good** (fuzzy + semantic):
```bash
$ tool find "getCookie"
Did you mean:
  Network.getCookies (distance: 1)
  Network.setCookie (distance: 3)
  Storage.getCookies (distance: 9)

$ tool find "cookie"
Found 14 methods:
  Network.getCookies - Returns all browser cookies
  Network.setCookie - Sets a cookie
  ...
```

**Implementation**:
```typescript
import { levenshtein } from './utils/levenshtein.js';

function searchMethods(query: string): SearchResult[] {
  const allMethods = getAllMethods();
  
  // Exact match
  const exact = allMethods.filter(m => 
    m.name.toLowerCase() === query.toLowerCase()
  );
  if (exact.length > 0) return exact;
  
  // Fuzzy match (typo tolerance)
  const fuzzy = allMethods
    .map(m => ({
      method: m,
      distance: levenshtein(m.name.toLowerCase(), query.toLowerCase()),
    }))
    .filter(r => r.distance <= 3)
    .sort((a, b) => a.distance - b.distance);
  
  if (fuzzy.length > 0) return fuzzy.map(r => r.method);
  
  // Semantic match (contains query)
  const semantic = allMethods.filter(m =>
    m.name.toLowerCase().includes(query.toLowerCase()) ||
    m.description.toLowerCase().includes(query.toLowerCase())
  );
  
  return semantic;
}
```

### Pattern 4: Example Generation

**Bad** (no examples):
```bash
$ tool describe send-request
Parameters:
  url: string
  method: GET | POST
  headers: object
```

**Good** (with examples):
```bash
$ tool describe send-request
Parameters:
  url: string (required)
  method: GET | POST (default: GET)
  headers: object (optional)

Examples:
  tool send-request --url https://api.example.com
  tool send-request --url https://api.example.com --method POST
  tool send-request --url https://api.example.com --headers '{"Auth":"Bearer xyz"}'
```

**Implementation**:
```typescript
function generateExamples(
  domain: string,
  method: string,
  schema: MethodSchema
): string[] {
  const examples: string[] = [];
  
  // Example 1: Minimal usage (required params only)
  const requiredParams = Object.entries(schema.parameters)
    .filter(([_, p]) => !p.optional)
    .map(([name, _]) => name);
  
  if (requiredParams.length === 0) {
    examples.push(`bdg cdp ${domain}.${method}`);
  } else {
    const params = buildMinimalParams(requiredParams, schema);
    examples.push(`bdg cdp ${domain}.${method} --params '${JSON.stringify(params)}'`);
  }
  
  // Example 2: Common usage pattern
  if (hasCommonPattern(domain, method)) {
    const params = getCommonPattern(domain, method);
    examples.push(`bdg cdp ${domain}.${method} --params '${JSON.stringify(params)}'`);
  }
  
  // Example 3: Full usage (all params)
  const fullParams = buildFullParams(schema.parameters);
  examples.push(`bdg cdp ${domain}.${method} --params '${JSON.stringify(fullParams)}'`);
  
  return examples;
}
```

## Anti-Patterns

### ❌ Anti-Pattern 1: Help Text Only

```bash
$ tool --help
# Outputs 500 lines of formatted text
# Agent must parse human-formatted output
# No structured data, no schema, no introspection
```

**Why it fails**: Parsing human text is error-prone and fragile.

**Fix**: Add `--help --json` mode.

### ❌ Anti-Pattern 2: External Schema Only

```bash
$ tool command
Error: Invalid parameters
See documentation at: https://docs.example.com/api/command
```

**Why it fails**:
- Requires web access
- Documentation may be stale
- Agent must context-switch

**Fix**: Embed schema in tool (`tool command --describe`).

### ❌ Anti-Pattern 3: Cryptic Errors

```bash
$ tool command --params '{...}'
Error: Invalid parameter
```

**Why it fails**: Agent doesn't know which parameter or why.

**Fix**: Structured error with details:
```json
{
  "error": "Invalid parameter",
  "details": {
    "parameter": "timeout",
    "provided": "string",
    "expected": "integer",
    "suggestion": "Use --params '{\"timeout\": 30}'"
  }
}
```

### ❌ Anti-Pattern 4: No Discovery Path

```bash
# Agent must know exact command name
$ tool magic-command-name
# No way to discover available commands
```

**Why it fails**: Agent can't explore capabilities.

**Fix**: Implement discovery hierarchy:
```bash
tool --list-commands
tool command --list-subcommands
tool command subcommand --describe
```

## Case Study: bdg's CDP Introspection

### Problem

Chrome DevTools Protocol has:
- 53 domains
- 300+ methods
- Thousands of parameters
- Complex type system

Traditional approach: "Read the docs at https://chromedevtools.github.io/devtools-protocol/"

### Solution: Multi-Level Self-Documentation

#### Level 0: Tool Schema
```bash
$ bdg --help --json
{
  "commands": [
    {
      "name": "cdp",
      "description": "Execute CDP commands or introspect protocol",
      "modes": ["execute", "list", "describe", "search"]
    }
  ]
}
```

#### Level 1: Domain Discovery
```bash
$ bdg cdp --list
Available CDP Domains (53):

Accessibility    Animation       Audits          Autofill
Browser          CSS             CacheStorage    Cast
Console          DOM             DOMDebugger     DOMSnapshot
Database         DeviceAccess    Emulation       EventBreakpoints
Fetch            HeadlessExperimental  IO        IndexedDB
Input            Inspector       LayerTree       Log
Media            Memory          Network         Overlay
Page             Performance     PerformanceTimeline  Preload
Profiler         Runtime         Schema          Security
ServiceWorker    Storage         SystemInfo      Target
Tracing          WebAudio        WebAuthn
```

#### Level 2: Method Discovery
```bash
$ bdg cdp Network --list
Network Domain Methods (39):

canClearBrowserCache          canClearBrowserCookies
canEmulateNetworkConditions   clearBrowserCache
clearBrowserCookies           clearAcceptedEncodingsOverride
continueInterceptedRequest    deleteCookies
disable                       emulateNetworkConditions
enable                        getAllCookies
getCertificate                getCookies
getRequestPostData            getResponseBody
getResponseBodyForInterception  getSecurityIsolationStatus
loadNetworkResource           replayXHR
searchInResponseBody          setAcceptedEncodings
setAttachDebugStack           setBlockedURLs
setBypassServiceWorker        setCacheDisabled
setCookie                     setCookies
setDataSizeLimitsForTest      setExtraHTTPHeaders
setRequestInterception        setUserAgentOverride
streamResourceContent         takeResponseBodyForInterceptionAsStream
```

#### Level 3: Method Schema
```bash
$ bdg cdp Network.getCookies --describe
{
  "domain": "Network",
  "method": "getCookies",
  "description": "Returns all browser cookies. Depending on the backend support, will return detailed cookie information in the cookies field. Deprecated. Use Storage.getCookies instead.",
  "parameters": {
    "urls": {
      "type": "array",
      "items": {"type": "string"},
      "optional": true,
      "description": "The list of URLs for which applicable cookies will be fetched. If not specified, it's assumed to be set to the list containing only the currently inspected URL."
    }
  },
  "returns": {
    "cookies": {
      "type": "array",
      "items": {"$ref": "Cookie"},
      "description": "Array of cookie objects."
    }
  },
  "examples": [
    "bdg cdp Network.getCookies",
    "bdg cdp Network.getCookies --params '{\"urls\":[\"https://example.com\"]}'",
    "bdg cdp Network.getCookies --params '{\"urls\":[\"https://example.com\",\"https://another.com\"]}'"
  ],
  "deprecated": true,
  "deprecation_message": "Use Storage.getCookies instead"
}
```

#### Level 4: Semantic Search
```bash
$ bdg cdp --search cookie
Found 14 methods matching 'cookie':

Network.getCookies
  Returns all browser cookies

Network.getAllCookies
  Returns all browser cookies for all URLs

Network.deleteCookies
  Deletes browser cookies with matching name and url or domain/path/partitionKey pair

Network.setCookie
  Sets a cookie with the given cookie data; may overwrite equivalent cookies if they exist

Network.setCookies
  Sets given cookies

Storage.getCookies
  Returns all browser cookies

Storage.setCookies
  Sets given cookies

Audits.getEncodedResponse
  Returns the response body and size if it were re-encoded with the specified settings. Only applies to images.
  (matches: contains 'Set-Cookie' in description)

... (6 more results)
```

#### Level 5: Typo Tolerance
```bash
$ bdg cdp Network.getCokies
Error: Method 'getCokies' not found in domain 'Network'

Did you mean:
  Network.getCookies (edit distance: 2)
  Network.setCookies (edit distance: 3)
  Network.getAllCookies (edit distance: 4)

Tip: Use 'bdg cdp Network --list' to see all available methods
```

### Results

The self-documenting approach enables:

**Progressive Discovery**:
- Agents start with zero knowledge of CDP
- Each introspection step reveals exactly what's needed next
- Natural progression from broad (domains) to specific (method schemas)

**Reduced External Dependencies**:
- No need to fetch Chrome DevTools Protocol documentation
- All schema information available offline
- Documentation can't drift (it's generated from the protocol itself)

**Error Prevention**:
- Type information helps agents construct valid requests
- Examples show correct usage patterns
- Typo detection guides agents to correct method names

## Measuring Success

### Quantitative Metrics

1. **Discovery Efficiency**
   - Time to first successful usage
   - Number of round trips needed
   - Context tokens consumed

2. **Success Rate**
   - First-try success percentage
   - Error rate before success
   - Retry attempts needed

3. **Coverage**
   - % of capabilities discoverable without docs
   - % of operations with examples
   - % of errors with structured details

### Qualitative Indicators

1. **Agent Autonomy**
   - Can agent learn tool without human intervention?
   - Does agent ask clarifying questions?
   - How often does agent give up?

2. **Error Recovery**
   - Can agent understand and fix errors?
   - Does agent learn from mistakes?
   - How quickly does agent recover?

3. **Exploration Depth**
   - Does agent discover advanced features?
   - Does agent combine capabilities creatively?
   - Does agent build mental model of tool?

## Related Concepts

### Self-Describing Protocols

Similar to:
- **GraphQL Introspection**: Query schema at runtime
- **OpenAPI/Swagger**: Machine-readable API specs
- **WSDL**: Web service descriptions
- **JSON Schema**: Self-describing data structures

### Progressive Disclosure

Related to:
- **Information Architecture**: Layered content organization
- **Cognitive Load Theory**: Just-in-time information
- **Wizard Patterns**: Step-by-step guidance

### Socratic Method

Inspired by:
- **Inquiry-Based Learning**: Learning through questions
- **Exploratory Testing**: Discovering through interaction
- **REPL Development**: Interactive exploration

## Conclusion

Self-documenting systems represent a paradigm shift in tool design for autonomous agents:

**Old Paradigm**: Tools require external documentation
- Agent reads docs → Agent uses tool
- Documentation becomes stale
- High context cost
- Discovery friction

**New Paradigm**: Tools teach agents directly
- Agent asks tool → Tool teaches agent → Agent uses tool
- Documentation is always current (it's the tool itself)
- Low context cost
- Natural discovery

### Key Takeaways

1. **Introspection is Essential**: Tools must describe themselves programmatically
2. **Discovery Over Documentation**: Enable exploration rather than require reading
3. **Progressive Disclosure**: Reveal information in layers, not all at once
4. **Examples are Critical**: Show, don't just tell
5. **Semantic Search Matters**: Agents think in concepts, not exact names

### Future Directions

1. **Dynamic Schema Generation**: Generate schemas from code automatically
2. **Interactive Tutorials**: Tools guide agents through first use
3. **Usage Analytics**: Tools learn which features need better discovery
4. **Cross-Tool Discovery**: Tools recommend related tools
5. **Capability Negotiation**: Tools and agents negotiate features

---

**See Also**:
- [AGENT_FRIENDLY_TOOLS.md](./AGENT_FRIENDLY_TOOLS.md) - Foundational principles
- [TYPE_SAFE_CDP.md](./TYPE_SAFE_CDP.md) - Implementation details
- [CLI_REFERENCE.md](./CLI_REFERENCE.md) - Human-focused documentation

**References**:
- Chrome DevTools Protocol: https://chromedevtools.github.io/devtools-protocol/
- GraphQL Introspection: https://graphql.org/learn/introspection/
- OpenAPI Specification: https://swagger.io/specification/
- Progressive Disclosure (Nielsen): https://www.nngroup.com/articles/progressive-disclosure/
