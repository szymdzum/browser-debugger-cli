# Claude Vision Image Sizing: Research & Implementation Guide

This document captures research on optimal screenshot sizing for Claude Vision and AI agents, including industry approaches, algorithms, and implementation recommendations.

## Table of Contents

1. [Claude Vision Constraints](#claude-vision-constraints)
2. [The Tall Page Problem](#the-tall-page-problem)
3. [Industry Approaches](#industry-approaches)
4. [AI Agent Screenshot Strategies](#ai-agent-screenshot-strategies)
5. [Academic Research: Token Reduction](#academic-research-token-reduction)
6. [Algorithms & Libraries](#algorithms--libraries)
7. [Implementation Recommendations](#implementation-recommendations)
8. [Real-World Validation](#real-world-validation)
9. [References](#references)

---

## Claude Vision Constraints

### Official Limits (Anthropic Documentation)

| Constraint | Value | Notes |
|------------|-------|-------|
| **Max edge** | 1568px | Longest edge limit |
| **Max megapixels** | 1.15MP | ~1,200,000 pixels |
| **Sweet spot** | 1092x1092 | ~1,600 tokens |
| **Token formula** | `(width x height) / 750` | Estimation algorithm |
| **Minimum edge** | 200px | Below this degrades quality |
| **Max file size** | 20MB | Per image |
| **Supported formats** | JPEG, PNG, GIF, WebP | Standard web formats |

### Aspect Ratio Guidelines

| Aspect Ratio | Max Dimensions | Approximate Tokens |
|--------------|----------------|-------------------|
| 1:1 | 1092x1092 | ~1,590 |
| 3:4 | 951x1268 | ~1,607 |
| 2:3 | 896x1344 | ~1,605 |
| 9:16 | 819x1456 | ~1,590 |
| 1:2 | 784x1568 | ~1,639 |

### Auto-Resize Behavior

If an image exceeds limits, Claude automatically resizes it:

1. Preserves aspect ratio
2. Scales to fit within 1568px longest edge
3. **Adds latency** without improving quality
4. Pre-resizing client-side is recommended

### Model Consistency

These specifications apply to **all Claude models**:
- Claude 3.5 Sonnet
- Claude 4 Sonnet / Opus
- Claude 4.5 Sonnet / Opus

The token formula and resize thresholds are consistent across the model family.

---

## The Tall Page Problem

### The Core Challenge

A very tall web page cannot fit within Claude's token budget at readable resolution.

**Example: Wikipedia Article**

| Metric | Original | Scaled (Longest Edge) | Result |
|--------|----------|----------------------|--------|
| Dimensions | 1866x37,833 | 77x1,568 | Unreadable |
| Tokens | 94,000 | 161 | Useless |

**The math:**
- Scale factor: `1568 / 37833 = 0.041`
- Width becomes: `1866 x 0.041 = 77px`
- **77px wide text is illegible**

### Why Simple Scaling Fails

For portrait pages with extreme aspect ratios:
- Scaling by longest edge destroys width
- Text becomes unreadable below ~400px width
- No amount of clever scaling solves this

### The Fundamental Trade-off

You cannot simultaneously have:
1. Complete page content
2. Readable resolution
3. Reasonable token count

**One must be sacrificed.**

### Token Cost Comparison

| Screenshot Type | Dimensions | Tokens | vs Optimal |
|-----------------|------------|--------|------------|
| Anthropic recommended | 1092x1092 | ~1,590 | baseline |
| Viewport (1080p) | 1920x1080 | ~2,770 | 1.7x |
| Typical full-page | 1920x5000 | ~12,800 | 8x |
| Long page | 3810x18152 | ~92,000 | 58x |

---

## Industry Approaches

### 1. Chunked/Tiled Capture

**Concept:** Split long pages into multiple screenshots, each optimized for vision models.

**Implementation:**
```
Page (1920x10000) -> [
  Chunk 1: 1072x1072 (~1,530 tokens)
  Chunk 2: 1072x1072 (~1,530 tokens)
  ...
  Chunk N: 1072xremaining
]
```

**Tools using this approach:**
- ShareX (Windows) - Scrolling capture with intelligent stitching
- FireShot Pro - Pagination into standard page sizes
- GoFullPage - Chrome extension with auto-scroll capture
- puppeteer-full-page-screenshot - npm package

**Pros:**
- Complete content captured
- Each chunk optimal for Claude
- No quality loss

**Cons:**
- Multiple images to process
- Complex stitching logic
- Increased API calls

### 2. Viewport-Only Capture

**Concept:** Only capture what's currently visible in the browser viewport.

**Implementation:**
```typescript
// CDP call without captureBeyondViewport
await CDP.send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: false
});
```

**Tools using this approach:**
- Browser-Use (AI agent framework)
- Most browser automation tools as default

**Pros:**
- Always within token budget
- Fast capture
- Contextually relevant (what user sees)

**Cons:**
- Loses off-screen content
- Requires scrolling for complete coverage

### 3. Smart Cropping (Saliency-Based)

**Concept:** Use computer vision to identify the most important region and crop to that.

**Algorithm (Smartcrop.js):**
1. Analyze image for "interesting" regions
2. Score potential crops based on:
   - Skin tone detection (faces)
   - Saturation (colorful areas)
   - Edge detection (detailed areas)
3. Select highest-scoring crop at desired aspect ratio

**Pros:**
- Automatically finds important content
- Works without user input

**Cons:**
- May miss intended target
- Unpredictable for structured content (web pages)
- Better suited for photos than UIs

### 4. Semantic Page Segmentation (VIPS)

**Concept:** Analyze page structure to identify semantic blocks (header, nav, content, footer, ads).

**VIPS Algorithm (Microsoft Research):**
1. Parse DOM structure
2. Extract visual cues (positions, sizes, colors)
3. Recursively segment into blocks
4. Build semantic tree
5. Identify "main content" vs "noise"

**Applications:**
- Auto-focus on article content
- Remove navigation/ads from screenshot
- Identify specific semantic regions

**Pros:**
- Intelligent content identification
- Can isolate "main content"
- Removes noise automatically

**Cons:**
- Complex implementation
- Requires DOM access
- May fail on non-standard layouts

### 5. Element-Targeted Capture

**Concept:** User specifies exact element to capture.

**Implementation:**
```bash
# Capture just the footer
bdg dom screenshot --selector "footer"

# Scroll to element and capture viewport
bdg dom screenshot --scroll-to "#main-content"
```

**Pros:**
- Precise control
- Always captures intended content
- Simple implementation

**Cons:**
- Requires user to know selectors
- Not automatic

---

## AI Agent Screenshot Strategies

### Browser-Use (Open Source)

**Repository:** https://github.com/browser-use/browser-use

**Approach:** Hybrid DOM + Vision
- Reads both HTML and screenshots
- Viewport-based capture
- Adaptive reasoning on failures

**Key insight:** They don't try to capture entire pages. They work viewport-by-viewport with intelligent navigation.

### Set-of-Mark (SoM) Prompting

**Paper:** https://arxiv.org/abs/2310.11441 (Microsoft Research)

**Approach:** Annotate screenshots with numbered markers
1. Use SAM/SEEM to segment image into regions
2. Overlay alphanumeric marks on each region
3. Agent references elements by mark ID

**Example:**
```
[Screenshot with overlaid numbers: 1-Header, 2-Search, 3-Nav, 4-Content...]

Agent: "Click on element 3 to navigate"
```

**Pros:**
- Precise element grounding
- Works with any vision model
- Enables coordinate-free interaction

**Cons:**
- Requires preprocessing step
- Marks may obscure content
- Only works well with GPT-4V

### AI-Employe

**Repository:** https://github.com/vignshwarar/AI-Employe

**Approach:** DOM indexing + Vision
1. Index entire DOM in search engine (MeiliSearch)
2. Vision model identifies element by text/appearance
3. Search engine returns exact element ID

**Pros:**
- Combines vision accuracy with DOM precision
- Reliable element identification

**Cons:**
- Complex infrastructure
- Requires search engine setup

---

## Academic Research: Token Reduction

### LLaVA-PruMerge

**Paper:** https://arxiv.org/html/2403.15388v4

**Key findings:**
- Visual tokens have significant redundancy
- CLIP activation patterns are sparse
- Can prune 60%+ tokens with minimal quality loss

**Method:**
1. Analyze class-spatial token activations in CLIP
2. Identify low-information tokens
3. Prune or merge redundant tokens
4. Feed reduced set to LLM

### iLLaVA

**Paper:** https://arxiv.org/html/2412.06263v1

**Tagline:** "An Image is Worth Fewer Than 1/3 Input Tokens"

**Method:**
- Merge redundant tokens instead of dropping
- Recycle pruned information into remaining tokens
- Works on both image encoder and LLM stages

**Results:**
- 66%+ token reduction
- Minimal quality degradation
- Faster inference

### ACT-IN-LLM

**Approach:** Adaptive compression within LLM layers
- Compresses KV cache in self-attention
- Different compression per layer
- ~60% token reduction, ~20% speedup

### Text-as-Image Compression

**Emerging research:** Render text as image for compression
- Long text -> Single image -> Fewer tokens
- Counterintuitive but effective
- Useful for document processing

---

## Algorithms & Libraries

### Smartcrop.js

**Repository:** https://github.com/jwagner/smartcrop.js

**Features:**
- Content-aware image cropping
- Saliency detection
- Face detection integration
- Browser, Node.js, and CLI support

**Performance:** <20ms for 640x427px image

**Usage:**
```javascript
const smartcrop = require('smartcrop-sharp');

const result = await smartcrop.crop(imageBuffer, {
  width: 1092,
  height: 1092
});
// result.topCrop = { x, y, width, height }
```

**Node.js options:**
- `smartcrop-sharp` - Uses libvips (fast)
- `smartcrop-gm` - Uses ImageMagick

### Sharp (Image Processing)

**Repository:** https://github.com/lovell/sharp

**Features:**
- High-performance image processing
- Resize, crop, format conversion
- Native bindings (libvips)

**Usage for screenshots:**
```javascript
const sharp = require('sharp');

await sharp(buffer)
  .resize(1568, 1568, { fit: 'inside' })
  .toBuffer();
```

### CDP Native Scaling

**No library needed** - Chrome DevTools Protocol supports scaling directly:

```typescript
await CDP.send('Page.captureScreenshot', {
  format: 'png',
  clip: {
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
    scale: 0.5  // 50% scale
  }
});
```

**Pros:**
- Zero dependencies
- Single-pass capture and resize
- No quality loss from re-encoding

---

## Implementation Recommendations

### Phase 1: Smart Defaults (Current)

**For normal pages (aspect ratio <= 3:1):**
```
Scale longest edge to 1568px
Token budget: ~1,600
```

**For tall pages (aspect ratio > 3:1):**
```
Default to viewport capture
Clear message explaining why
JSON includes structured reasoning
```

**New option:**
```bash
--scroll-to <selector>  # Scroll element into view, capture viewport
```

### Phase 2: Chunked Capture

**New option:**
```bash
--paginate  # Returns array of 1072x1072 chunks
```

**Output:**
```json
{
  "chunks": [
    { "path": "page-001.png", "region": { "y": 0, "height": 1072 } },
    { "path": "page-002.png", "region": { "y": 1072, "height": 1072 } }
  ],
  "totalHeight": 5000,
  "chunkCount": 5
}
```

### Phase 3: Smart Region Detection

**Options:**
```bash
--smart-crop       # Use saliency to find important region
--main-content     # Auto-detect and capture main content area
```

**Implementation:**
- Integrate smartcrop.js for saliency
- Use DOM analysis for semantic detection
- VIPS-inspired block identification

### Phase 4: Element Annotation (SoM-Style)

**Option:**
```bash
--annotate  # Overlay element indices on screenshot
```

**Output:**
```json
{
  "path": "annotated.png",
  "elements": [
    { "index": 1, "selector": "header", "bounds": {...} },
    { "index": 2, "selector": "nav", "bounds": {...} }
  ]
}
```

---

## Decision Matrix

| Scenario | Recommended Approach |
|----------|---------------------|
| General page inspection | Viewport capture |
| Specific element needed | `--selector` or `--scroll-to` |
| Complete page archive | `--no-resize` or `--paginate` |
| AI agent automation | Viewport + scroll-to |
| Documentation/testing | Full resolution |

---

## Token Budget Calculator

```typescript
/**
 * Calculate estimated Claude Vision tokens for image dimensions.
 */
function calculateTokens(width: number, height: number): number {
  return Math.ceil((width * height) / 750);
}

/**
 * Calculate optimal dimensions to fit within token budget.
 */
function fitToTokenBudget(
  width: number,
  height: number,
  maxTokens: number = 1600
): { width: number; height: number; scale: number } {
  const maxPixels = maxTokens * 750;
  const currentPixels = width * height;

  if (currentPixels <= maxPixels) {
    return { width, height, scale: 1 };
  }

  const scale = Math.sqrt(maxPixels / currentPixels);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    scale
  };
}
```

---

## Real-World Validation

### Test Case: Claude Shannon Wikipedia Article

We tested the auto-resize feature on [Claude Shannon's Wikipedia page](https://en.wikipedia.org/wiki/Claude_Shannon) - a lengthy biographical article with extensive content. The father of information theory makes a fitting test subject for compression optimization.

#### Page Characteristics

- **Full page height:** 75,666 pixels (on 2x Retina display)
- **Aspect ratio:** 20.3:1 (far exceeds 3:1 threshold)
- **Content:** Dense text, images, tables, references

#### Results Comparison

| Mode | Command | Dimensions | Tokens | File Size |
|------|---------|------------|--------|-----------|
| Full resolution | `--no-resize` | 3732×75666 | **376,515** | 35 MB |
| Default (auto) | *(none)* | 2946×3136 | **12,319** | 911 KB |
| Viewport only | `--no-full-page` | 2946×3136 | 12,319 | 911 KB |
| Scroll to section | `--scroll "#References"` | 2946×3136 | 12,319 | 34 KB |

#### Key Findings

**1. Tall Page Detection Triggered**

The auto-resize correctly detected the extreme aspect ratio and fell back to viewport capture:

```json
{
  "fullPageSkipped": {
    "reason": "page_too_tall",
    "originalHeight": 37833,
    "aspectRatio": 20.3
  }
}
```

**2. Token Savings: 97%**

| Metric | Full Resolution | Auto-Resize | Savings |
|--------|-----------------|-------------|---------|
| Tokens | 376,515 | 12,319 | **97%** |
| File size | 35 MB | 911 KB | **97%** |
| Est. cost* | ~$1.50 | ~$0.05 | **97%** |

*At Claude's approximate pricing of $0.40/1M tokens for vision.

**3. Scroll Feature Works**

The `--scroll` option successfully navigated to the References section and captured a viewport-sized screenshot with the section visible.

#### Why This Matters

Without auto-resize, a single Wikipedia article screenshot would cost **376k tokens**. For an AI agent browsing multiple pages, this quickly becomes prohibitive:

| Scenario | Pages | Tokens (no resize) | Tokens (auto) |
|----------|-------|-------------------|---------------|
| Single page | 1 | 376,515 | 12,319 |
| Research session | 10 | 3,765,150 | 123,190 |
| Extended browsing | 50 | 18,825,750 | 615,950 |

The auto-resize feature makes vision-based browsing economically viable.

---

## References

### Official Documentation
- [Vision - Claude Docs](https://docs.claude.com/en/docs/build-with-claude/vision)
- [Anthropic Vision Guide](https://docs.anthropic.com/en/docs/build-with-claude/vision)
- [Chrome DevTools Protocol - Page.captureScreenshot](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureScreenshot)

### Libraries & Tools
- [Smartcrop.js](https://github.com/jwagner/smartcrop.js) - Content-aware image cropping
- [Sharp](https://github.com/lovell/sharp) - High-performance image processing
- [Browser-Use](https://browser-use.com/) - AI browser agent framework
- [puppeteer-full-page-screenshot](https://www.npmjs.com/package/puppeteer-full-page-screenshot)

### Research Papers
- [Set-of-Mark Prompting](https://arxiv.org/abs/2310.11441) - Visual grounding for GPT-4V
- [LLaVA-PruMerge](https://arxiv.org/html/2403.15388v4) - Adaptive token reduction
- [iLLaVA](https://arxiv.org/html/2412.06263v1) - Efficient token merging
- [VIPS Algorithm](https://www.researchgate.net/publication/243473339_VIPS_a_Vision-based_Page_Segmentation_Algorithm) - Vision-based page segmentation

### Articles & Guides
- [Bannerbear: Puppeteer Screenshot Optimization](https://www.bannerbear.com/blog/ways-to-speed-up-puppeteer-screenshots/)
- [ScreenshotOne: Full Page Screenshot Guide](https://screenshotone.com/blog/a-complete-guide-on-how-to-take-full-page-screenshots-with-puppeteer-playwright-or-selenium/)
- [Cloudinary: Smart Cropping](https://cloudinary.com/blog/introducing_smart_cropping_intelligent_quality_selection_and_automated_responsive_images)
- [Medium: Claude Vision Capability](https://medium.com/@judeaugustinej/vision-capability-from-claude-4150e6023d98)

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2024-11-27 | 1.0 | Initial research compilation |

---

*This document is maintained as part of the bdg CLI project. See [Issue #116](https://github.com/szymdzum/browser-debugger-cli/issues/116) for implementation tracking.*
