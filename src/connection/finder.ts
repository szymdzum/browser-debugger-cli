import { CDPTarget } from '../types.js';
import { normalizeUrl } from '../utils/url.js';

export async function findTarget(url: string, port = 9222): Promise<CDPTarget> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json`);
    
    if (!response.ok) {
      throw new Error(
        `Chrome not responding on port ${port}.\n` +
        `Please start Chrome with: chrome --remote-debugging-port=${port} --user-data-dir=/tmp/chrome-bdg`
      );
    }

    const targets: CDPTarget[] = await response.json();
    const pageTargets = targets.filter(t => t.type === 'page');

    if (pageTargets.length === 0) {
      throw new Error('No browser tabs found. Please open a tab in Chrome.');
    }

    // Normalize the search URL
    const searchUrl = normalizeUrl(url);

    // Try exact match first
    let target = pageTargets.find(t => t.url === searchUrl);
    
    // Try URL contains
    if (!target) {
      target = pageTargets.find(t => t.url.includes(url));
    }
    
    // Try hostname match
    if (!target) {
      try {
        const searchHost = new URL(searchUrl).host;
        target = pageTargets.find(t => {
          try {
            return new URL(t.url).host === searchHost;
          } catch {
            return false;
          }
        });
      } catch {
        // Invalid URL, skip hostname matching
      }
    }

    if (!target) {
      const availableTabs = pageTargets
        .map((t, i) => `  ${i + 1}. ${t.url}`)
        .join('\n');
      
      throw new Error(
        `No browser tab found for: ${url}\n\n` +
        `Available tabs:\n${availableTabs}`
      );
    }

    return target;
  } catch (error) {
    if (error instanceof Error && error.message.includes('fetch')) {
      throw new Error(
        `Cannot connect to Chrome on port ${port}.\n` +
        `Please start Chrome with: chrome --remote-debugging-port=${port} --user-data-dir=/tmp/chrome-bdg`
      );
    }
    throw error;
  }
}

export async function validateTarget(targetId: string, port = 9222): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json`);
    if (!response.ok) {
      return false;
    }
    const targets: CDPTarget[] = await response.json();
    return targets.some(t => t.id === targetId);
  } catch {
    return false;
  }
}
