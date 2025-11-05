# Social Media Assets

This directory contains ASCII art logos and branding assets for the Browser Debugger CLI project.

## Logo Files

### `terminal-logo.txt`
Terminal window style logo showing BDG in action. Best for:
- Social media previews
- Documentation splash screens
- Terminal-style presentations

### `block-logo.txt`
Modern block letter style logo. Best for:
- GitHub social preview image
- README headers
- Marketing materials
- Conference slides

## Creating a Social Preview Image

### Requirements
- **Size**: 1280x640px (2:1 aspect ratio)
- **Format**: PNG or JPG
- **Max file size**: 1MB

### Recommended Tools
- [Figma](https://figma.com) - Professional design tool
- [Canva](https://canva.com) - Quick template-based design
- [Carbon](https://carbon.now.sh) - Code screenshot generator

### Design Guidelines

**Colors** (based on Catppuccin Mocha theme):
```
Background:     #1e1e2e (dark blue-gray)
Logo (green):   #a6e3a1
Logo (cyan):    #89dceb
Logo (blue):    #89b4fa
Title text:     #cdd6f4 (light gray)
Subtitle text:  #9399b2 (medium gray)
Accent:         #f38ba8 (red/pink)
```

**Fonts**:
- Logo: Fira Code, JetBrains Mono, Monaco, SF Mono (monospace)
- Title: Same as logo or Inter/SF Pro
- Body: Inter, SF Pro, or system font

**Layout**:
```
┌─────────────────────────────────┐
│                                 │
│         [ASCII LOGO]            │
│                                 │
│    Browser Debugger CLI         │
│    Chrome DevTools Protocol     │
│         telemetry               │
│                                 │
└─────────────────────────────────┘
```

## Uploading to GitHub

1. Go to: `https://github.com/YOUR_USERNAME/browser-debugger-cli/settings`
2. Scroll to **"Social preview"** section
3. Click **"Edit"** or **"Upload an image..."**
4. Upload your 1280x640px image
5. Save changes

## Verification

After uploading, test the preview by:
1. Pasting the GitHub URL in Microsoft Teams, Slack, or Discord
2. Using [Open Graph Debugger](https://www.opengraph.xyz/)
3. Checking on Twitter/X with the card validator

## Quick Start with Socialify

For a quick auto-generated preview:

```bash
# Download auto-generated image
curl -o social-preview.png "https://socialify.git.ci/YOUR_USERNAME/browser-debugger-cli/image?description=1&font=Source%20Code%20Pro&language=1&name=1&owner=1&pattern=Circuit%20Board&theme=Dark"
```

Then upload to GitHub as described above.
