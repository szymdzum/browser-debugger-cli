# BDG Capture Optimization Plan

## Overview

This plan focuses on making `bdg` faster and less resource intensive when capturing telemetry from arbitrary web targets. The changes target repeat pain points observed while investigating `http://localhost:3000/customer/register`, but they apply to any session where analysts only need a subset of the collected data.

The document is structured around:

1. **Modules to evolve** – where the current architecture forces expensive operations.
2. **Problematic workflows** – how those modules manifest during real captures.
3. **CDP-powered selective capture** – using Chrome DevTools Protocol for intelligent data filtering.
4. **Agent-friendly tool selection** – discoverable profiles and recommendation system.
5. **Concrete improvements** – configuration, code changes, and CLI additions.
6. **Implementation roadmap** – phased plan with cross-module dependencies and test considerations.

---

## Modules to Address

| Module | Current Behaviour | Why It Hurts |
| --- | --- | --- |
| `src/cli/handlers/PreviewWriter.ts` | Every 5 s builds **both** preview and full payloads, then writes them. | Generates ~80 MB stringifications + I/O churn even when analysts only need a quick peek. |
| `src/utils/session.ts` (`writePartialOutputAsync`, `writeFullOutputAsync`) | Always pretty-print full arrays and log timings. | No filtering/compaction, so disk writes balloon and logs spam shells. |
| `src/cli/handlers/OutputBuilder.ts` | Supports `preview`, `full`, `final` only. | No way to emit "network-summary", "DOM-only", etc.; forces post-processing. |
| `src/cli/handlers/sessionController.ts` | Session lifecycle always spins up PreviewWriter, all collectors, memory logging. | No concept of "quick profile" or conditional collectors. |
| `src/cli/commands/start.ts` | CLI options cover Chrome launch only. | Users can't request lean captures (`--profile summary`, `--network-filter ...`). |
| `src/collectors/*.ts` | Always capture everything from enabled domains. | No selective filtering at CDP level; post-processing waste. |

---

## Painful Processes & Examples

1. **Repeated Full Snapshots**  
   - Scenario: Investigating the Castorama register page. In 15 s we emitted five `session.full.json` files, each ~78 MB.  
   - Impact: ~400 MB temporary files, repeated 200 ms `JSON.stringify`, token-heavy perf logs.  
   - Observation: we only needed DOM inputs and the `marketingChannels` payload.

2. **Unfiltered Network Harvest**  
   - Scenario: Same run captured fonts, SVGs, third-party pixels (`google.com/pagead`, `pixel.wp.pl`, etc.).  
   - Impact: parsing these to find relevant requests cost extra time; most data was noise.  
   - Desired behaviour: block known-static domains or extend CLI to pass include/exclude lists.

3. **One-Size Output**  
   - Scenario: After capture we had to manually parse `session.json`, grep for `marketingConsent`, decode sourcemaps, etc.  
   - Impact: manual work spilled into tokens and time; there is no built-in "show me network payload containing X".  
   - Desired behaviour: BDG exports targeted summaries (forms detected, API hits, etc.).

4. **Rigid Lifecycle**  
   - Scenario: Even a "one-off DOM capture" spawns PreviewWriter + collectors + memory logger.  
   - Impact: extra complexity for quick tasks like "list inputs on this form".  
   - Desired behaviour: a fast profile to connect → snapshot DOM → disconnect (no preview loop).

5. **Tool Discovery Gap**
   - Scenario: Agents and users don't know which profile/options to use for their task.
   - Impact: Default to full capture even when targeted capture would be 10x more efficient.
   - Desired behaviour: Smart recommendations based on URL patterns and use cases.

---

## CDP-Powered Selective Capture

### Network Domain Filtering Strategies

**Pre-filtering via Request Blocking:**
```typescript
// Block unwanted request types before they generate events
await cdp.send('Network.setBlockedURLs', {
  urlPatterns: [
    { urlPattern: '*.png', block: true },
    { urlPattern: '*.css', block: true },
    { urlPattern: '*.woff2', block: true },
    { urlPattern: '*analytics*', block: true },
    { urlPattern: '*tracking*', block: true }
  ]
});
```

**Buffer Size Management:**
```typescript
await cdp.send('Network.enable', {
  maxTotalBufferSize: 1024 * 1024,      // 1MB total buffer
  maxResourceBufferSize: 100 * 1024,    // 100KB per resource  
  maxPostDataSize: 50 * 1024            // 50KB POST data limit
});
```

**Conditional Response Body Fetching:**
```typescript
cdp.on('Network.responseReceived', async (params) => {
  const { response, requestId } = params;
  
  // Only fetch bodies for JSON API responses
  if (response.mimeType === 'application/json' && 
      response.url.includes('/api/') &&
      response.status < 400) {
    const { body } = await cdp.send('Network.getResponseBody', { requestId });
    // Store only relevant response bodies...
  }
  // Skip body fetch for static assets, errors, etc.
});
```

### DOM Domain Selective Capture

**Targeted Element Selection:**
```typescript
// Find specific content without full DOM traversal
const { searchId, resultCount } = await cdp.send('DOM.performSearch', {
  query: 'input[type="email"], form, [class*="error"]',
  includeUserAgentShadowDOM: false
});

if (resultCount > 0) {
  const { nodeIds } = await cdp.send('DOM.getSearchResults', {
    searchId, fromIndex: 0, toIndex: Math.min(10, resultCount)
  });
  
  // Get HTML only for relevant nodes
  for (const nodeId of nodeIds) {
    const { outerHTML } = await cdp.send('DOM.getOuterHTML', { nodeId });
    // Process only form-related elements...
  }
}
```

**Smart DOM Snapshots:**
```typescript
// Capture DOM with controlled depth and filtering
const { root } = await cdp.send('DOM.getDocument', {
  depth: 2,  // Limit initial depth
  pierce: false  // Skip iframes/shadow DOM initially
});

// Expand specific branches on-demand
const formNodes = await cdp.send('DOM.querySelectorAll', {
  nodeId: root.nodeId,
  selector: 'form, [data-testid*="form"], [class*="checkout"]'
});
```

### DOMSnapshot Domain Optimization

**Metadata-Only Snapshots:**
```typescript
const { documents, strings } = await cdp.send('DOMSnapshot.captureSnapshot', {
  computedStyles: ['display', 'visibility'],  // Minimal CSS properties
  includeDOMRects: false,                     // Skip layout rectangles
  includePaintOrder: false,                   // Skip paint order
  includeBlendedBackgroundColors: false      // Skip color calculations
});
// Results in 70-80% smaller snapshots
```

---

## Agent-Friendly Tool Selection

### Discovery Commands

**Profile Listing:**
```bash
# Machine-readable profile discovery
bdg profiles list --format json
{
  "profiles": {
    "form-analysis": {
      "description": "Captures form elements, validation errors, and input interactions",
      "collectors": ["dom", "network"],
      "use_cases": ["form debugging", "validation analysis", "UX testing"],
      "token_efficiency": "high",
      "typical_output_size": "50-200KB",
      "filtering": {
        "dom_selectors": ["form", "input", "[class*='error']"],
        "network_patterns": ["/api/validate*", "/api/submit*"]
      }
    },
    "api-monitoring": {
      "description": "Tracks API requests, responses, and error patterns",
      "collectors": ["network", "console"], 
      "use_cases": ["API debugging", "performance analysis"],
      "token_efficiency": "medium",
      "typical_output_size": "100-500KB",
      "filtering": {
        "network_include": ["/api/*", "/graphql"],
        "network_exclude": ["*.css", "*.js", "*.png"],
        "console_levels": ["error", "warn"]
      }
    }
  }
}
```

**Capability Discovery:**
```bash
# Agent discovers what filtering/selection options are available
bdg capabilities --format json
{
  "collectors": {
    "dom": {
      "selective_capture": true,
      "css_selectors": true,
      "search_patterns": true,
      "depth_control": true
    },
    "network": {
      "url_filtering": true,
      "content_type_filtering": true,
      "size_limits": true,
      "request_blocking": true
    }
  },
  "output_formats": ["json", "jsonl", "summary"],
  "cdp_filtering": {
    "network_blocking": true,
    "buffer_limits": true,
    "selective_bodies": true,
    "dom_search": true
  }
}
```

### Context-Aware Recommendations

**URL Pattern Matching:**
```bash
# Agent gets smart recommendations based on URL
bdg recommend --url "localhost:3000/checkout" --format json
{
  "recommended_profiles": [
    {
      "name": "form-analysis",
      "confidence": 0.9,
      "reasoning": "Checkout pages typically contain forms and validation",
      "estimated_size": "150KB",
      "estimated_tokens": "8000"
    },
    {
      "name": "payment-flow",
      "confidence": 0.8, 
      "reasoning": "May involve payment processing APIs",
      "estimated_size": "300KB",
      "estimated_tokens": "15000"
    }
  ],
  "suggested_command": "bdg capture --profile form-analysis localhost:3000/checkout"
}
```

**Interactive Selection:**
```bash
# Human-friendly interactive mode
bdg select-profile --url "localhost:3000/signup" --interactive

# Agent-optimized structured selection
bdg select-profile --url "localhost:3000/signup" --format json --mode agent
```

### Smart Defaults with Override Capability

```bash
# Smart default selection (follows agent-friendly principles)
bdg capture localhost:3000/signup
# Auto-selects 'form-analysis' profile based on URL pattern

# Agent override with specific requirements  
bdg capture localhost:3000/signup \
  --profile custom \
  --collectors dom,network \
  --dom-selectors "form,input,[data-error]" \
  --network-include "/api/user/*" \
  --cdp-block "*.css,*.js,*.png" \
  --format json --compact
```

---

## Improvement Themes

### 1. Capture Profiles with CDP Integration

| Profile | Collectors | CDP Filtering | Output | Token Efficiency |
| --- | --- | --- | --- | --- |
| `full` | dom, network, console | minimal blocking | preview/full/final | baseline |
| `form-analysis` | dom, network | block assets, API-only bodies | DOM forms + validation APIs | 80% reduction |
| `api-monitoring` | network, console | block static, size limits | JSON responses + errors | 70% reduction |
| `dom-only` | dom | N/A | targeted DOM snapshot | 90% reduction |
| `performance` | network | block tracking, compress | timing + critical path | 60% reduction |

**CDP Filter Profiles:**
```typescript
const profileFilters = {
  'form-analysis': {
    network: {
      blockedPatterns: ['*.css', '*.js', '*.png', '*.woff*'],
      includedPatterns: ['/api/validate*', '/api/submit*', '/api/form*'],
      maxResponseSize: 100 * 1024
    },
    dom: {
      selectors: ['form', 'input', 'select', 'textarea', '[class*="error"]'],
      searchTerms: ['validation', 'error', 'required']
    }
  },
  'api-monitoring': {
    network: {
      blockedPatterns: ['*.css', '*.js', '*.png', '*analytics*'],
      contentTypes: ['application/json', 'application/xml'],
      maxTotalBuffer: 2 * 1024 * 1024
    }
  }
};
```

### 2. CDP Filter Manager

```typescript
class CDPFilterManager {
  constructor(private cdp: CDPConnection) {}
  
  async applyProfile(profile: string): Promise<void> {
    const filters = profileFilters[profile];
    
    if (filters.network) {
      // Set up network filtering
      await this.cdp.send('Network.setBlockedURLs', {
        urlPatterns: filters.network.blockedPatterns.map(pattern => ({
          urlPattern: pattern,
          block: true
        }))
      });
      
      // Configure buffer limits
      await this.cdp.send('Network.enable', {
        maxTotalBufferSize: filters.network.maxTotalBuffer,
        maxResourceBufferSize: filters.network.maxResponseSize
      });
    }
    
    if (filters.dom) {
      // Set up targeted DOM collection
      this.domSelectors = filters.dom.selectors;
      this.searchTerms = filters.dom.searchTerms;
    }
  }
  
  shouldCaptureResponse(response: NetworkResponse): boolean {
    const filters = this.currentFilters.network;
    return filters.contentTypes.includes(response.mimeType) &&
           response.encodedDataLength < filters.maxResponseSize;
  }
}
```

### 3. Enhanced Output Builders

```typescript
class SummaryBuilder {
  buildFormSummary(domData: DOMData): FormSummary {
    return {
      forms: this.extractForms(domData),
      inputs: this.extractInputs(domData),
      validation_errors: this.extractErrors(domData),
      submission_endpoints: this.findSubmissionUrls(domData)
    };
  }
  
  buildApiSummary(networkData: NetworkRequest[]): ApiSummary {
    return {
      endpoints: this.groupByEndpoint(networkData),
      error_responses: networkData.filter(r => r.status >= 400),
      slow_requests: networkData.filter(r => r.duration > 1000),
      payload_sizes: this.calculatePayloadSizes(networkData)
    };
  }
}
```

### 4. Structured Error Handling for Tool Selection

```json
{
  "error": {
    "code": "PROFILE_NOT_FOUND",
    "type": "configuration_error", 
    "message": "Profile 'advanced-forms' not found",
    "details": {
      "requested_profile": "advanced-forms",
      "available_profiles": ["form-analysis", "api-monitoring", "dom-only"]
    },
    "recoverable": true,
    "suggestions": [
      "Use 'bdg profiles list' to see available profiles",
      "Try 'bdg recommend --url <url>' for suggestions", 
      "Use 'form-analysis' profile for similar functionality"
    ]
  }
}
```

### 5. Self-Describing Tool Introspection

```bash
# Tool describes its own capabilities
bdg --schema
{
  "commands": {
    "capture": {
      "parameters": {
        "profile": {
          "type": "string",
          "enum": ["full", "form-analysis", "api-monitoring", "dom-only"],
          "description": "Capture profile with predefined filters"
        },
        "collectors": {
          "type": "array",
          "items": {"enum": ["dom", "network", "console"]},
          "description": "Specific data collectors to enable"
        }
      }
    }
  }
}
```

---

## Implementation Roadmap

### Phase 1 – Profile & Discovery Infrastructure

1. **Profile Registry System**
   - Create `src/profiles/ProfileRegistry.ts` with built-in profile definitions
   - Add machine-readable profile metadata (use cases, token efficiency, size estimates)
   - Implement `bdg profiles list --format json` command

2. **Tool Introspection Commands**
   - Add `bdg capabilities --format json` for feature discovery
   - Add `bdg recommend --url <url> --format json` for context-aware suggestions
   - Add `bdg --schema` for self-describing API

3. **CLI Enhancement**
   - Extend `start.ts` to parse `--profile`, `--collectors`, `--format` flags
   - Add structured error handling with semantic exit codes
   - Implement `--compact` flag for token-optimized output

**Tests:**
- Unit tests for profile registry and recommendation engine
- JSON schema validation for all structured outputs
- CLI integration tests with agent-friendly flag combinations

### Phase 2 – CDP Filtering Layer

1. **CDPFilterManager Implementation**
   - Create `src/cdp/CDPFilterManager.ts` with profile-based filtering
   - Implement `Network.setBlockedURLs` integration
   - Add buffer size management via `Network.enable` parameters

2. **Selective Collectors**
   - Update `NetworkCollector` to use conditional body fetching
   - Update `DOMCollector` to support targeted element capture
   - Add `DOMSnapshot.captureSnapshot` optimization

3. **Response Filtering**
   - Implement content-type and size-based response filtering
   - Add on-demand `Network.getResponseBody` fetching
   - Create selective DOM search using `DOM.performSearch`

**Tests:**
- Unit tests for CDP filter manager with mocked connections
- Integration tests ensuring blocked URLs never appear in output
- Performance benchmarks comparing filtered vs unfiltered capture

### Phase 3 – Enhanced Output & Summarization

1. **SummaryBuilder Implementation**  
   - Create `src/builders/SummaryBuilder.ts` with form/API extraction
   - Implement structured summaries (forms detected, API endpoints, errors)
   - Add token-efficient output formatting

2. **Multi-Format Output**
   - Add JSON Lines writer for append-only logging
   - Add compressed output option (`--gzip-output`)
   - Create summary-only output mode (`--summary-only`)

3. **Agent-Optimized UX**
   - Add `--compact` mode with reduced whitespace/metadata
   - Implement piping compatibility for command chaining
   - Add exit codes with semantic meaning

**Tests:**
- Snapshot tests for summary output formats
- Token efficiency benchmarks (compare output sizes)
- Composability tests with Unix pipes and jq

### Phase 4 – Advanced Features

1. **Custom Profile Support**
   - Support `~/.bdg/profiles.json` for user-defined profiles
   - Add `bdg profile create <name>` interactive wizard
   - Profile validation and error reporting

2. **Context Learning**
   - Track usage patterns for recommendation improvement
   - Cache optimal profiles per domain/URL pattern
   - Add `--learn` flag to improve future recommendations

3. **Performance Optimization**
   - Streaming JSON output for large captures
   - Incremental DOM diffing for change detection
   - Memory-mapped file I/O for large sessions

**Tests:**
- User acceptance tests for profile creation workflow
- Performance regression tests with large data sets
- Memory usage profiling under various configurations

---

## Example Workflows After Implementation

### Agent Workflows

```bash
# Agent discovers and selects optimal tool
PROFILE=$(bdg recommend --url "$URL" --format json | jq -r '.recommended_profiles[0].name')
bdg capture --profile "$PROFILE" --format json "$URL" > capture.json

# Agent chains operations with structured output
bdg capture --profile api-monitoring --format jsonl "$URL" | \
  jq 'select(.type == "network" and .status >= 400)' > errors.json

# Agent gets token-efficient summary
bdg capture --profile form-analysis --summary-only --compact "$URL" | \
  jq '.data.forms | length'
```

### Human Workflows

```bash
# Human gets interactive profile selection
bdg select-profile --url "localhost:3000/checkout" --interactive

# Human uses semantic profiles with defaults
bdg form-analysis localhost:3000/signup    # Maps to --profile form-analysis
bdg api-debug localhost:3000/api/users     # Maps to --profile api-monitoring

# Human gets helpful errors and suggestions
bdg capture --profile missing-profile localhost:3000
# Error: Profile 'missing-profile' not found
# Suggestions: Try 'bdg profiles list' or 'bdg recommend --url localhost:3000'
```

### Performance Comparisons

| Scenario | Current | Optimized | Improvement |
| --- | --- | --- | --- |
| Form analysis | 78MB full capture | 150KB form-focused | 99.8% size reduction |
| API debugging | 45MB with assets | 3MB JSON-only | 93% size reduction |
| DOM inspection | Full tree + styles | Targeted elements | 90% size reduction |
| Token usage | 50K tokens | 8K tokens | 84% token reduction |

---

## Success Metrics

### Performance Targets
- **Size reduction**: 70-95% smaller outputs for targeted profiles
- **Token efficiency**: 60-85% fewer tokens for agent processing
- **Capture speed**: 2-5x faster for focused data collection
- **Memory usage**: 50-80% less memory for filtered captures

### User Experience Targets
- **Discovery time**: <30s for agents to find optimal profile
- **Setup complexity**: Single command for 80% of use cases
- **Error recovery**: Clear next steps in 100% of error messages
- **Documentation**: Self-describing tools requiring zero external docs

### Technical Quality Targets
- **Test coverage**: >90% for all profile and filtering logic  
- **Backward compatibility**: 100% compatibility with existing commands
- **Schema compliance**: All JSON output validates against published schemas
- **Performance regression**: <5% overhead when using default 'full' profile

---

## References

- [CDP Network Domain](https://chromedevtools.github.io/devtools-protocol/tot/Network/) – request blocking, buffer limits, response body fetching
- [CDP DOM Domain](https://chromedevtools.github.io/devtools-protocol/tot/DOM/) – targeted element selection, search, selective HTML
- [CDP DOMSnapshot Domain](https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/) – optimized bulk snapshots with filtering
- [CDP Log Domain](https://chromedevtools.github.io/devtools-protocol/tot/Log/) – selective console monitoring
- [Agent-Friendly Tools Design Principles](./AGENT_FRIENDLY_TOOLS.md) – structured output, tool introspection, semantic behavior
- [DevTools Protocol Monitor](https://developer.chrome.com/docs/devtools/protocol-monitor) – manual reconnaissance for discovering optimal CDP commands

---

## Next Steps

1. **Stakeholder Alignment**
   - Review profile names and use cases with product team
   - Validate CDP filtering approach with performance team
   - Confirm agent-friendly UX patterns with AI integration team

2. **Technical Preparation**
   - Prototype CDP filtering with small test cases
   - Design profile registry schema and validation
   - Create performance benchmarking framework

3. **Implementation Planning**
   - Break down Phase 1 into 2-week sprints
   - Set up CI pipeline for agent-friendly output validation  
   - Create integration test suite for profile combinations

4. **Documentation & Training**
   - Update CLAUDE.md with new profile-based workflows
   - Create example scripts for common agent use cases
   - Document CDP filtering patterns for advanced users