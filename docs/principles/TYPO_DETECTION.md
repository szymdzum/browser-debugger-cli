# Typo Detection and Fuzzy Matching

> **How bdg helps agents and humans recover from typos automatically**

## Table of Contents

- [The Problem](#the-problem)
- [The Solution: Edit Distance](#the-solution-edit-distance)
- [Understanding Levenshtein Distance](#understanding-levenshtein-distance)
- [Implementation in bdg](#implementation-in-bdg)
- [Why This Matters for Agents](#why-this-matters-for-agents)
- [Examples](#examples)
- [Performance Considerations](#performance-considerations)
- [Related Concepts](#related-concepts)

## The Problem

When working with 300+ CDP methods, typos are inevitable:

```bash
# Human or agent types:
$ bdg cdp Network.getCokies

# Without typo detection:
Error: Method 'getCokies' not found
# Dead end. User has to guess what went wrong.

# With typo detection:
Error: Method 'getCokies' not found in domain 'Network'

Did you mean:
  Network.getCookies (distance: 2)
  Network.setCookies (distance: 3)
  Network.getAllCookies (distance: 4)
```

**The difference**: User can immediately see the correct spelling and fix their command.

### Why Typos Happen More with Agents

1. **LLMs can hallucinate method names**: "getCookie" (singular) instead of "getCookies"
2. **Case sensitivity issues**: "getHTMLDocument" vs "getHtmlDocument"
3. **Autocomplete failures**: Model truncates or completes incorrectly
4. **Token boundaries**: Tokens split across method names leading to errors

Without typo detection, each mistake requires a full round trip: error → agent thinks → retry. With typo detection, the error message itself provides the fix.

## The Solution: Edit Distance

**Edit distance** (also called **Levenshtein distance**) measures how many single-character changes are needed to transform one string into another.

### Three Operations

Only three types of edits are allowed:

1. **Insertion**: Add a character
2. **Deletion**: Remove a character  
3. **Substitution**: Replace one character with another

### Example: "getCokies" → "getCookies"

```
getCokies
    ↓ (insert 'o' after 'k')
getCokoies
    ↓ (delete second 'i')
getCokoes
    ↓ (substitute 'e' with 'i')
getCookies
```

Wait, that's 3 operations. But there's a more efficient path:

```
getCokies
    ↓ (substitute 'k' with 'o')
getCooies
    ↓ (substitute first 'i' with 'k')
getCookies
```

That's only **2 operations** - which is the minimum. The algorithm finds the shortest path automatically.

## Understanding Levenshtein Distance

### The Intuition

Imagine you have two strings aligned:

```
g e t C o k i e s
g e t C o o k i e s
```

You can see the differences:
- Position 5: 'k' should be 'o' (substitute)
- Position 6-7: Missing 'o' (insert)

But how do you find the **minimum** number of operations programmatically?

### The Dynamic Programming Approach

The algorithm builds a matrix where each cell represents the edit distance between prefixes of the two strings.

#### Example: "cat" → "dog"

```
    ""  d  o  g
""   0  1  2  3
c    1  1  2  3
a    2  2  2  3
t    3  3  3  3
```

Let's break this down:

**Initialization** (first row and column):
- Converting "" to "d" requires 1 insertion
- Converting "" to "do" requires 2 insertions
- Converting "" to "dog" requires 3 insertions
- Converting "c" to "" requires 1 deletion
- Converting "ca" to "" requires 2 deletions
- Converting "cat" to "" requires 3 deletions

**Filling the matrix** (each cell):

For cell [i][j], we consider three options:
1. **Deletion**: Delete from string 1 → cell[i-1][j] + 1
2. **Insertion**: Insert into string 1 → cell[i][j-1] + 1
3. **Substitution**: Replace character → cell[i-1][j-1] + cost
   - cost = 0 if characters match
   - cost = 1 if characters differ

Take the minimum of these three.

**Example calculation** for "ca" → "do" (cell [2][2]):

```
Current characters: 'a' from "ca", 'o' from "do"

Option 1 (deletion): "c" → "do" = 2, plus delete 'a' = 2 + 1 = 3
Option 2 (insertion): "ca" → "d" = 2, plus insert 'o' = 2 + 1 = 3  
Option 3 (substitution): "c" → "d" = 1, plus substitute 'a'→'o' = 1 + 1 = 2

Minimum = 2
```

**Final answer**: Bottom-right cell = **3**
- "cat" → "dog" requires 3 substitutions (c→d, a→o, t→g)

### Visual Example: "kitten" → "sitting"

```
         ""  s  i  t  t  i  n  g
    ""    0  1  2  3  4  5  6  7
    k     1  1  2  3  4  5  6  7
    i     2  2  1  2  3  4  5  6
    t     3  3  2  1  2  3  4  5
    t     4  4  3  2  1  2  3  4
    e     5  5  4  3  2  2  3  4
    n     6  6  5  4  3  3  2  3
```

**Steps to get distance 3**:

1. **Substitute** 'k' → 's': "sitten"
2. **Substitute** 'e' → 'i': "sittin"  
3. **Insert** 'g' at end: "sitting"

Distance = **3**

### Why This Algorithm Works

**Key insight**: The minimum edit distance for two strings can be computed from smaller subproblems.

If you know the distance between:
- "kitte" and "sittin" (removing last char from both)
- "kitten" and "sittin" (removing last char from first)
- "kitte" and "sitting" (removing last char from second)

Then you can compute the distance between "kitten" and "sitting" by considering which operation is cheapest.

This is a classic **dynamic programming** approach: solve small problems first, use those solutions to solve bigger problems.

## Implementation in bdg

### The Code

```typescript
/**
 * Calculate Levenshtein distance between two strings.
 * Used for finding similar method names.
 *
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Edit distance between strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  // Initialize first column (deletions)
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  
  // Initialize first row (insertions)
  const firstRow = matrix[0];
  if (firstRow) {
    for (let j = 0; j <= len2; j++) {
      firstRow[j] = j;
    }
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= len1; i++) {
    const currentRow = matrix[i];
    if (!currentRow) continue;

    for (let j = 1; j <= len2; j++) {
      // If characters match, no cost
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      
      // Consider all three operations
      const deletion = (matrix[i - 1]?.[j] ?? 0) + 1;
      const insertion = (currentRow[j - 1] ?? 0) + 1;
      const substitution = (matrix[i - 1]?.[j - 1] ?? 0) + cost;
      
      // Take the minimum
      currentRow[j] = Math.min(deletion, insertion, substitution);
    }
  }

  return matrix[len1]?.[len2] ?? 0;
}
```

### Usage in CDP Command Handler

```typescript
// When method not found, find similar names
const suggestions = allMethods
  .map(method => ({
    name: method,
    distance: levenshteinDistance(typo.toLowerCase(), method.toLowerCase()),
  }))
  .filter(s => s.distance <= 3)  // Only show close matches
  .sort((a, b) => a.distance - b.distance)  // Closest first
  .slice(0, 5);  // Top 5 suggestions

if (suggestions.length > 0) {
  console.error('\nDid you mean:');
  suggestions.forEach(s => {
    console.error(`  ${s.name} (distance: ${s.distance})`);
  });
}
```

### The Distance Threshold

**Why filter at distance ≤ 3?**

```
Distance 1: Very likely typo
  getCookie → getCookies (missing 's')
  
Distance 2: Probable typo
  getCokies → getCookies (swapped letters)
  
Distance 3: Possible typo
  gtCookies → getCookies (missing 'e', wrong first letter)
  
Distance 4+: Probably a different word
  setBlocked → getCookies (not helpful)
```

The threshold of 3 strikes a balance between helpful suggestions and noise.

## Why This Matters for Agents

### 1. Forgiving LLM Output

LLMs don't always generate perfect method names:

```python
# LLM might generate:
"Network.getCookie"  # Singular instead of plural
→ Suggests: "Network.getCookies" (distance: 1)

# Or hallucinate:
"Network.getAllCookie"
→ Suggests: "Network.getAllCookies" (distance: 1)
```

### 2. Case Insensitivity Through Distance

```bash
$ bdg cdp network.getcookies  # All lowercase
→ "Did you mean: Network.getCookies (distance: 0)"
```

Actually, bdg handles this with case-insensitive comparison first, but if that fails, Levenshtein catches case errors.

### 3. Faster Recovery

Without typo detection:
```
Agent tries → Error → Agent analyzes error → Agent searches docs → 
Agent tries again → Success
(3-4 round trips)
```

With typo detection:
```
Agent tries → Error with suggestion → Agent uses suggestion → Success
(1-2 round trips)
```

### 4. Learning from Mistakes

Agents can build a mapping of common errors:
```
"getCookie" (tried) → "getCookies" (suggested, worked)
→ Agent learns: CDP methods use plural forms
```

## Examples

### Example 1: Simple Typo

```bash
$ bdg cdp Network.setCokies
Error: Method 'setCokies' not found in domain 'Network'

Did you mean:
  Network.setCookies (distance: 2)
  Network.getCookies (distance: 3)
```

**Why these suggestions?**
- `setCokies` → `setCookies`: substitute 'k'→'o', insert 'o' = distance 2
- `setCokies` → `getCookies`: substitute 's'→'g', substitute 'k'→'o', insert 'o' = distance 3

### Example 2: Missing Characters

```bash
$ bdg cdp Page.captureScrenshot
Error: Method 'captureScrenshot' not found in domain 'Page'

Did you mean:
  Page.captureScreenshot (distance: 1)
```

**Why distance 1?**
- `captureScrenshot` → `captureScreenshot`: insert 'e' after 'Scr' = distance 1

### Example 3: Transposed Letters

```bash
$ bdg cdp Runtime.evaulate
Error: Method 'evaulate' not found in domain 'Runtime'

Did you mean:
  Runtime.evaluate (distance: 2)
```

**Why distance 2?**
- `evaulate` → `evaluate`: delete 'u', insert 'l' after 'a' = distance 2
- (Or: substitute positions - the algorithm finds the optimal path)

### Example 4: Multiple Errors

```bash
$ bdg cdp Netwrk.gtCokies
Error: Domain 'Netwrk' not found

Did you mean:
  Network (distance: 1)
```

Then after fixing domain:
```bash
$ bdg cdp Network.gtCokies
Error: Method 'gtCokies' not found in domain 'Network'

Did you mean:
  Network.getCookies (distance: 3)
```

**Note**: Distance 3 is at the threshold. More errors and it won't suggest anything.

## Performance Considerations

### Time Complexity

The basic algorithm is **O(m × n)** where:
- m = length of first string
- n = length of second string

For CDP method names:
- Average length: ~15-20 characters
- Comparison: ~400 operations per method
- Total methods: ~300
- **Total: ~120,000 operations** for full search

This is fast enough on modern hardware (< 1ms).

### Space Complexity

The matrix requires **O(m × n)** space. For typical method names (20 chars × 20 chars), that's only 400 cells × 8 bytes = 3.2 KB per comparison.

### Optimization: Early Exit

```typescript
// If strings are very different in length, skip calculation
if (Math.abs(str1.length - str2.length) > 3) {
  return Infinity;  // Can't be within threshold
}
```

This optimization isn't implemented in bdg yet but could speed up suggestions.

### Optimization: Only Calculate When Needed

bdg only runs Levenshtein distance when:
1. Exact match fails (case-sensitive)
2. Case-insensitive match fails
3. Partial match fails

So most successful commands never trigger the algorithm.

## Related Concepts

### Damerau-Levenshtein Distance

An extension that also allows **transposition** (swapping adjacent characters):

```
"evalutae" → "evaluate"
Standard Levenshtein: 4 operations (delete 'u', delete 'a', insert 'a', insert 'u')
Damerau-Levenshtein: 1 operation (transpose 'a' and 'u')
```

Not implemented in bdg because:
- Standard Levenshtein is simpler
- Transpositions are rare in CDP method names
- The complexity isn't worth the marginal benefit

### Fuzzy Matching vs Edit Distance

**Edit distance** (Levenshtein): How many changes needed?
**Fuzzy matching** (fzf): How similar are these strings?

Fuzzy matching often uses:
- Substring matching
- Character frequency
- Position weighting
- Multiple algorithms combined

Edit distance is simpler and sufficient for bdg's use case.

### Soundex and Phonetic Algorithms

**Soundex**: Match words that sound similar
- "Smith" and "Smyth" get same code
- Useful for names, not for method names

Not relevant for bdg since method names are programmatic, not phonetic.

## Conclusion

Typo detection via Levenshtein distance is a small feature with big impact:

1. **Makes tools more forgiving** - Humans and agents make mistakes
2. **Faster error recovery** - Suggestions in the error message itself
3. **Better UX** - No need to manually search for correct spelling
4. **Agent-friendly** - LLMs can learn from suggestions

The algorithm itself is elegant: dynamic programming solving a simple problem (how many edits?) in an efficient way.

**Key takeaways**:
- Edit distance = minimum single-character changes needed
- Dynamic programming builds solution from smaller subproblems  
- Distance threshold (≤3) balances helpfulness vs noise
- Simple implementation, big usability win

---

**Further Reading**:
- [Levenshtein Distance (Wikipedia)](https://en.wikipedia.org/wiki/Levenshtein_distance)
- [Dynamic Programming Introduction](https://en.wikipedia.org/wiki/Dynamic_programming)
- [The original 1965 paper](https://nymity.ch/sybilhunting/pdf/Levenshtein1966a.pdf) (Russian)

**Related bdg Docs**:
- [SELF_DOCUMENTING_SYSTEMS.md](./SELF_DOCUMENTING_SYSTEMS.md) - Progressive discovery patterns
- [AGENT_FRIENDLY_TOOLS.md](./AGENT_FRIENDLY_TOOLS.md) - Error handling philosophy

**Implementation**:
- Source: `src/commands/cdp.ts` (function `levenshteinDistance`)
