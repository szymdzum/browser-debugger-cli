# Code Refactoring Prompt: Clarity and Readability Enhancement

## Core Philosophy

**Code should be self-explanatory for the "what" - use clear variable names, function names, and structure**  
**Comments explain the "why" - decisions, constraints, gotchas, context that isn't obvious from reading the code**

Apply the 80/20 principle: Focus on high-impact, low-risk improvements that maximize readability gains while preserving functionality.

## Refactoring Techniques

### 1. Constants Extraction Pattern

**Extract magic numbers and repeated string literals into well-named constants**

```typescript
// Before
const port = options.port ?? 9222;
console.error(`Launching Chrome with CDP on port ${port}...`);
console.error(`Chrome launched successfully (PID: ${launcher.pid})`);

// After  
const DEFAULT_CDP_PORT = 9222;
const CHROME_LAUNCH_START_MESSAGE = (port: number) => `Launching Chrome with CDP on port ${port}...`;
const CHROME_LAUNCH_SUCCESS_MESSAGE = (pid: number) => `Chrome launched successfully (PID: ${pid})`;

const port = options.port ?? DEFAULT_CDP_PORT;
console.error(CHROME_LAUNCH_START_MESSAGE(port));
console.error(CHROME_LAUNCH_SUCCESS_MESSAGE(launcher.pid));
```

### 2. String Literal Extraction Pattern

**Extract all string literals to constants at the top of the file for maintainability**

```typescript
// Before
throw new Error(`Invalid port number: ${port}. Port must be between 1 and 65535.`);
console.error('Connection lost: no pong received');
this.ws.close(1001, 'No pong received');

// After
// Error Messages
const INVALID_PORT_ERROR = (port: number) => 
  `Invalid port number: ${port}. Port must be between 1 and 65535.`;
const CONNECTION_LOST_MESSAGE = 'Connection lost: no pong received';
const NO_PONG_RECEIVED_REASON = 'No pong received';

throw new Error(INVALID_PORT_ERROR(port));
console.error(CONNECTION_LOST_MESSAGE);
this.ws.close(1001, NO_PONG_RECEIVED_REASON);
```

### 3. Inline Comment Removal Strategy

**Remove comments that explain "what" the code does - make the code self-explanatory instead**

```typescript
// Before
// Build chrome-launcher options
const chromePath = findChromeBinary();
const chromeOptions = buildChromeOptions(options);

// Create launcher instance  
const launcher = new chromeLauncher.Launcher(finalOptions);

// After
const chromePath = findChromeBinary();
const chromeOptions = buildChromeOptions(options);
const launcher = new chromeLauncher.Launcher(finalOptions);
```

### 4. Function Naming Improvements

**Make function names describe their purpose and constraints, not just their mechanics**

```typescript
// Before
function pickDefined(obj) { ... }
function convertPrefsToJSONLike(prefs) { ... }

// After
function omitUndefinedProperties(obj) { ... }  // Explains why we're filtering
function ensureJSONCompatiblePrefs(prefs) { ... }  // Explains the constraint being enforced
```

### 5. Variable Naming for Clarity

**Use descriptive variable names that include units, context, or purpose**

```typescript
// Before
const launchDuration = Date.now() - launchStart;
const pid = launcher.pid ?? 0;

// After
const launchDurationMs = Date.now() - launchStart;  // Explicit units
const chromeProcessPid = launcher.pid ?? 0;  // Context about what this PID represents
```

### 6. JSDoc Enhancement Pattern

**Transform JSDoc from describing "what" to explaining "why" decisions were made**

```typescript
// Before
/**
 * Get the default persistent user-data-dir path.
 * Uses ~/.bdg/chrome-profile to persist cookies and settings.
 */

// After
/**
 * Get the default persistent user-data-dir path.
 * 
 * We use a persistent directory to maintain browser state (cookies, localStorage,
 * session storage) across sessions. This prevents users from having to
 * repeatedly log in or accept cookie consent dialogs during debugging workflows.
 */
```

### 7. Self-Documenting Code Principles

**Structure code and names so the intention is clear without comments**

```typescript
// Before
// Prefs file takes precedence
if (options.prefsFile) {
  // Load from file
} else {
  // Use inline prefs
}

// After
function loadChromePrefs(options: LaunchOptions) {
  // File-based preferences take precedence over inline preferences because
  // files allow for complex, reusable configurations that can be version
  // controlled and shared across team members or CI environments.
  
  if (options.prefsFile) {
    return loadPrefsFromFile(options.prefsFile);
  }
  return options.prefs;
}
```

## Risk Assessment Framework

### Low-Risk (Safe to refactor)
- ✅ Renaming internal/private functions
- ✅ Extracting constants for magic numbers
- ✅ Removing obvious "what" comments
- ✅ Improving variable names
- ✅ Enhancing JSDoc descriptions

### Medium-Risk (Proceed with caution)
- ⚠️ Changing function signatures
- ⚠️ Modifying error handling patterns
- ⚠️ Restructuring complex logic flows
- ⚠️ Breaking apart large functions

### High-Risk (Skip unless critical)
- ❌ Changing public API interfaces
- ❌ Modifying external dependency interactions
- ❌ Altering core business logic
- ❌ Breaking into multiple files

## What to Remove

**Inline comments that explain obvious "what":**
- `// Create instance`
- `// Build options object`  
- `// Call the function`
- `// Return the result`
- `// Loop through items`
- `// Check if exists`
- `// Set default value`

## What to Keep/Enhance

**Comments that explain non-obvious "why":**
- Business logic decisions
- Technical constraints and limitations
- Performance considerations
- Security requirements
- Integration quirks and workarounds
- Edge case handling rationale

## Application Process

1. **Scan for magic numbers and string literals** → Extract as named constants at top of file
2. **Extract all string literals** → Create organized constant groups (errors, messages, templates)
3. **Identify obvious "what" comments** → Remove and make code self-explanatory  
4. **Review function names** → Ensure they describe purpose/constraints
5. **Check variable names** → Add context, units, or specificity
6. **Enhance JSDoc** → Replace "what" with "why" explanations
7. **Verify no breaking changes** → Test that functionality is preserved

## Success Criteria

- [ ] Magic numbers replaced with named constants
- [ ] String literals extracted to organized constants at top of file
- [ ] Error messages and templates use consistent formatting
- [ ] No comments that explain obvious code mechanics
- [ ] Function names clearly indicate their purpose
- [ ] Variable names are descriptive and include context
- [ ] JSDoc explains decisions and constraints, not just descriptions
- [ ] Code reads like well-written prose
- [ ] All tests still pass
- [ ] No breaking changes to public APIs

## Common Pitfalls to Avoid

- Don't remove comments that explain complex business logic
- Don't rename exported functions without checking all call sites
- Don't extract constants that are only used once
- Don't make variable names overly verbose
- Don't change error handling behavior while refactoring
- Don't optimize performance during readability refactoring
- Don't extract string literals that are truly one-time configuration values
- Don't create overly complex template functions for simple static strings

## String Literal Organization

**Group extracted constants by purpose and create clear sections**

```typescript
// Connection Configuration
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10000;

// Error Messages
const CONNECTION_TIMEOUT_ERROR = 'Connection timeout';
const NOT_CONNECTED_ERROR = 'Not connected to browser';

// Message Templates
const CONNECTION_ATTEMPT_FAILED_MESSAGE = (attempt: number, delay: number) =>
  `Connection attempt ${attempt + 1} failed, retrying in ${delay}ms...`;
const RECONNECTING_MESSAGE = (delay: number, attempt: number, max: number) =>
  `Reconnecting in ${delay}ms... (attempt ${attempt}/${max})`;

// Technical Constants
const UTF8_ENCODING = 'utf8';
const WEBSOCKET_NORMAL_CLOSURE = 1000;
```

**Benefits:**
- **Maintainability:** All strings centralized for easy updates
- **Consistency:** Standardized message formatting across modules
- **Internationalization:** Ready for i18n system integration
- **Debugging:** Easier to find and modify error messages

## Template for JSDoc "Why" Explanations

```typescript
/**
 * [Brief description of what the function does]
 * 
 * [Explain WHY this approach was chosen:]
 * - Why this design over alternatives
 * - What constraints drive the implementation  
 * - What problems this solves
 * - What gotchas or edge cases exist
 * 
 * @param param - Description
 * @returns Description
 * @throws Description of error conditions
 */
```

---

**Usage:** Apply this prompt to any TypeScript/JavaScript file that needs clarity and readability improvements while maintaining functionality and avoiding breaking changes.