# UI Design Specification

Design approach: Editorial-tech hybrid. Clean, restrained mission control aesthetic with typographic hierarchy borrowed from editorial design. Avoids generic "tech dashboard" clichés (dark mode + neon blue) in favor of adaptive light/dark with serif accents.

## Design Philosophy

**Core principles:**
1. **Restraint** — Generous whitespace, single accent color, minimal borders
2. **Typographic hierarchy** — Three font families (serif/sans/mono) with clear roles
3. **Data as content** — Numbers and telemetry get editorial treatment (serif for big numbers)
4. **Adaptive theme** — CSS variables support light/dark modes, but designed light-first
5. **Production credibility** — Looks like something SpaceX/Planet Labs would deploy, not a hackathon project

**Visual references:**
- Bloomberg Terminal (density without clutter)
- NASA mission control (technical but readable)
- Editorial dashboards (NYT graphics, The Pudding)

## Color Palette

### Light Mode (Primary)

```css
--color-bg-primary: #ffffff;
--color-bg-secondary: #f5f5f5;
--color-bg-tertiary: #fafafa;

--color-text-primary: #1a1a1a;
--color-text-secondary: #6b6b6b;
--color-text-tertiary: #9ca3af;

--color-border-primary: rgba(0, 0, 0, 0.15);
--color-border-secondary: rgba(0, 0, 0, 0.1);
--color-border-tertiary: rgba(0, 0, 0, 0.05);

--color-accent: #ff6b35; /* Amber/orange — mission control classic */
--color-success: #4ade80; /* Green for nominal status */
--color-warning: #fbbf24; /* Yellow for warnings */
--color-danger: #ef4444;  /* Red for alerts */
```

### Dark Mode

```css
--color-bg-primary: #0a0a0a;
--color-bg-secondary: #1a1a1a;
--color-bg-tertiary: #2a2a2a;

--color-text-primary: #e8e6e0; /* Warm white */
--color-text-secondary: #888880;
--color-text-tertiary: #5a5a54;

--color-border-primary: rgba(255, 255, 255, 0.2);
--color-border-secondary: rgba(255, 255, 255, 0.12);
--color-border-tertiary: rgba(255, 255, 255, 0.06);

/* Semantic colors stay the same */
```

**Accent color rationale:**
- Orange (#ff6b35) is neutral — not "tech blue", not red (reserved for alerts)
- Evokes heat/energy (relevant for satellites, solar activity)
- High contrast in both light/dark modes
- Distinct from competitive dashboards (most use blue/cyan)

## Typography

### Font Families

```css
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
--font-serif: 'Playfair Display', Georgia, 'Times New Roman', serif;
--font-mono: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
```

**Load weights:**
- Inter: 400 (regular), 500 (medium) — no bold (600/700 too heavy against light UI)
- Playfair Display: 400, 500 italic
- JetBrains Mono: 400, 500

### Type Scale

```css
/* Display (brand mark) */
--text-display: 24px / 1.2 / 500 / var(--font-serif) italic;

/* Headings */
--text-h1: 22px / 1.3 / 500 / var(--font-serif);
--text-h2: 18px / 1.4 / 500 / var(--font-serif);
--text-h3: 16px / 1.4 / 500 / var(--font-sans);

/* Body */
--text-body: 14px / 1.6 / 400 / var(--font-sans);
--text-small: 12px / 1.5 / 400 / var(--font-sans);
--text-tiny: 11px / 1.4 / 400 / var(--font-sans);

/* Data (monospace) */
--text-data-lg: 24px / 1.2 / 500 / var(--font-mono);
--text-data-md: 16px / 1.3 / 500 / var(--font-mono);
--text-data-sm: 13px / 1.4 / 400 / var(--font-mono);
--text-data-xs: 11px / 1.3 / 400 / var(--font-mono);
```

### Usage Guide

| Element | Family | Example |
|---------|--------|---------|
| Brand mark | Serif italic | "orbit.ctrl" |
| Section headers | Serif | "Live orbital view" |
| Subsection headers | Sans medium | "Upcoming passes" |
| Data labels | Sans regular | "Bus voltage", "Internal temp" |
| Large numbers | Mono medium | "28.14", "419.7" |
| Small numbers | Mono regular | "14:31:09 UTC", "Z = 3.2" |
| Body text | Sans regular | Agent responses, descriptions |
| UI buttons | Sans medium | "Connect", "Refresh" |

## Layout Structure

### Overall Grid (Desktop 1440px+)

```
┌─────────────────────────────────────────────────────────┐
│ Header (56px fixed)                                     │
├───────┬─────────────────────────┬───────────────────────┤
│ Left  │ Main Globe Area         │ Right Rail            │
│ Rail  │ (flexible, min 400px)   │ (380px fixed)         │
│ 280px │                         │                       │
│       │                         │ - Agent Chat (top)    │
│       │                         │ - Satellite Detail    │
│       │                         │   (bottom)            │
├───────┴─────────────────────────┴───────────────────────┤
│ Telemetry Strip (120px fixed) — 4 metric cards         │
├─────────────────────────────────────────────────────────┤
│ Alert Log (auto-height, max 200px)                     │
└─────────────────────────────────────────────────────────┘
```

### Responsive Breakpoints

**Desktop (1440px+):** Layout as shown above

**Tablet (768px - 1439px):**
- Hide left rail, show satellite list as dropdown
- Main globe takes center
- Right rail stacks below (full width)

**Mobile (<768px):**
- Single column stack
- Globe takes full width, fixed height 300px
- All panels stack vertically
- Telemetry cards stack 2×2 grid

## Component Specifications

### Header Bar

**Height:** 56px  
**Background:** `var(--color-bg-primary)`  
**Border bottom:** `1px solid var(--color-border-tertiary)`  
**Padding:** `0 20px`

**Layout:**
```
[Brand Mark "orbit.ctrl"] [Status Indicator] [Spacer] [UTC Clock] [Mission Time]
```

**Brand Mark:**
- Font: Playfair Display 15px italic medium
- Color: `var(--color-text-primary)`
- Hover: subtle scale(1.02)

**Status Indicator:**
- Dot: 6px circle, `var(--color-success)` (nominal) or `var(--color-warning)` (degraded)
- Label: 11px sans, `var(--color-text-secondary)`, "nominal" / "degraded"

**Clock:**
- Font: JetBrains Mono 11px
- Color: `var(--color-text-secondary)`
- Format: "2026-05-12 · 14:31:09 UTC"
- Updates every second

### Left Rail — Satellite List

**Width:** 280px  
**Background:** `var(--color-bg-secondary)`  
**Border right:** `1px solid var(--color-border-tertiary)`  
**Padding:** `16px`

**Header:**
- "Active tracking" — Playfair Display 13px
- Count badge: "(3)" — mono 10px tertiary

**Satellite Row:**
```
[Dot] ISS (ZARYA)     [Status]
      ↓ mono 10px
      419.7 km · 7.66 km/s
```

- Dot: 6px circle, color-coded by status
  - Green: nominal
  - Amber: selected
  - Red: anomaly active
- Name: Sans 13px medium
- Data: Mono 10px tertiary
- Hover: `background: var(--color-bg-primary)`, cursor pointer
- Selected: `border-left: 2px solid var(--color-accent)`

**Categories Filter:**
- Dropdown or tabs: "Stations / SpaceX / Weather / GPS / All"
- Sans 11px, tertiary when inactive

### Main Globe Area

**Min width:** 400px  
**Height:** Flex to available space  
**Background:** Transparent (globe provides own background)  
**Padding:** `16px`

**Title:**
- "Live orbital view" — Playfair Display 13px
- Satellite count: Mono 10px tertiary "(142 tracked)"

**Globe Settings (overlay, top-right):**
- Icons: 16px, tertiary color
- Options: Day/Night toggle, Grid lines, Ground tracks

**Legend (overlay, bottom-left):**
- Color swatches (6px circles) with labels
- Sans 10px tertiary
- Example: "[Amber dot] selected target  [Blue dot] anomaly active  [Gray dot] nominal"

### Right Rail — Agent Chat Panel

**Width:** 380px  
**Background:** `var(--color-bg-secondary)`  
**Border left:** `1px solid var(--color-border-tertiary)`  
**Padding:** `16px`

**Header:**
- "Agent" — Playfair Display 13px
- Model badge: "claude-opus-4.7" — Mono 10px tertiary

**Message List:**
- User message:
  - Background: `var(--color-bg-tertiary)`
  - Padding: `8px 12px`
  - Border radius: `8px`
  - Sans 12px
- Assistant message:
  - No background
  - Mono 11px for tool calls (prefixed with "→")
  - Sans 12px for natural language response
  - Syntax highlighting for JSON/code blocks

**Input:**
- Textarea: 36px min-height, auto-expand
- Placeholder: "Ask about satellites, space weather, anomalies..."
- Border: `1px solid var(--color-border-secondary)`
- Focus: `border-color: var(--color-accent)`

### Right Rail — Selected Satellite Detail

**Position:** Below agent chat  
**Background:** `var(--color-bg-primary)`  
**Border:** `1px solid var(--color-border-tertiary)`  
**Border radius:** `8px`  
**Padding:** `12px 14px`

**Layout:**
```
ISS (ZARYA)           [Close X]
NORAD 25544

ALT    419.7 km
VEL    7.66 km/s
NEXT   14:32 UTC
```

**Styling:**
- Name: Sans 14px medium
- NORAD ID: Mono 11px tertiary
- Labels: Sans 10px tertiary, uppercase
- Values: Mono 13px medium
- Spacing: 8px between rows

### Telemetry Strip

**Height:** 120px  
**Background:** `var(--color-bg-secondary)`  
**Border top:** `1px solid var(--color-border-tertiary)`  
**Padding:** `12px 16px`

**Metric Card (4 across, equal width):**

```
┌─────────────────┐
│ Bus voltage     │ ← Sans 10px tertiary
│ 28.14 V         │ ← Mono 16px medium + 11px unit
│ [Sparkline]     │ ← 18px height
└─────────────────┘
```

**Card styling:**
- No background (blend with strip)
- Border right: `1px solid var(--color-border-tertiary)` (except last)
- Padding: `0 12px`

**Sparkline:**
- Library: Recharts LineChart
- Stroke: Green (#3B6D11) for nominal, Amber (#BA7517) for warn, Red for alert
- Stroke width: 1px
- No axes, no grid, no dots
- 100 data points max (downsample if needed)

**Status colors:**
- Green: value in nominal range
- Amber: approaching threshold (Z > 2)
- Red: anomaly detected (Z > 3)

### Alert Log

**Height:** Auto (max 200px, scrollable)  
**Background:** `var(--color-bg-secondary)`  
**Border top:** `1px solid var(--color-border-tertiary)`  
**Padding:** `10px 16px`

**Alert Row:**
```
[Icon] 14:21:09 UTC   HST — temperature drift detected   Z = 3.2 · severity warn
```

**Styling:**
- Icon: 14px warning triangle (amber) or alert circle (red)
- Timestamp: Mono 11px tertiary
- Message: Sans 12px
- Metadata: Mono 11px tertiary, right-aligned
- Row padding: `8px 0`
- Border bottom: `1px solid var(--color-border-tertiary)`

**Severity colors:**
- Warn: Amber icon, amber accent on Z-score
- Alert: Red icon, red accent on Z-score

## Interactive States

### Hover States

**Satellite Row:**
- Background: `var(--color-bg-primary)`
- Cursor: pointer
- Transition: 150ms ease

**Button:**
- Background: `var(--color-bg-tertiary)`
- Border: `1px solid var(--color-border-secondary)`
- Transition: 100ms ease

**Globe Satellite Marker:**
- Scale: 1.2
- Glow: `box-shadow: 0 0 12px var(--color-accent)`

### Focus States

**Input/Textarea:**
- Border: `1px solid var(--color-accent)`
- Outline: `2px solid rgba(255, 107, 53, 0.2)`
- Outline offset: 2px

**Button:**
- Outline: `2px solid var(--color-accent)`
- Outline offset: 2px

### Active States

**Button:**
- Transform: `scale(0.98)`
- Background: `var(--color-bg-secondary)`

**Satellite Row (selected):**
- Border left: `2px solid var(--color-accent)`
- Background: `var(--color-bg-tertiary)`

### Loading States

**Globe:**
- Skeleton: wireframe Earth with pulsing opacity
- Message: "Loading orbital data..." — Sans 12px tertiary

**Telemetry Card:**
- Skeleton bars for sparkline
- Shimmer effect on value

**Agent Response:**
- Typing indicator: "..." pulsing — Mono 12px tertiary

### Error States

**WebSocket Disconnect:**
- Banner at top: "Reconnecting to telemetry stream..."
- Background: `var(--color-warning)`
- Text: Dark amber
- Icon: Spinner

**API Error:**
- Toast notification: bottom-right
- Background: `var(--color-danger)`
- Text: White
- Auto-dismiss: 5 seconds

## Animation Guidelines

**Principles:**
- Subtle, functional animations only
- No gratuitous motion (this isn't a marketing site)
- Respect `prefers-reduced-motion`

**Allowed animations:**
- Satellite orbital motion: continuous, 60fps target
- Sparkline updates: smooth line transition (300ms ease)
- Panel expand/collapse: 200ms ease-out
- Hover/focus transitions: 100-150ms ease
- Loading spinners: continuous rotation

**Forbidden:**
- Auto-playing particle effects
- Parallax scrolling
- Pulsing/glowing UI chrome
- Slide-in notifications (use fade instead)

## Accessibility

**Minimum requirements:**

1. **Color contrast:**
   - Text on background: 4.5:1 minimum (WCAG AA)
   - Status colors distinguishable for colorblind users (use icons + text, not color alone)

2. **Keyboard navigation:**
   - All interactive elements reachable via Tab
   - Focus indicators visible (2px outline)
   - Satellite selection via arrow keys

3. **Screen readers:**
   - Semantic HTML (`<nav>`, `<main>`, `<section>`)
   - ARIA labels for icon buttons
   - Live regions for telemetry updates (polite, not assertive)

4. **Reduced motion:**
   ```css
   @media (prefers-reduced-motion: reduce) {
     * {
       animation-duration: 0.01ms !important;
       transition-duration: 0.01ms !important;
     }
   }
   ```

## Responsive Behavior

### Desktop (1440px+)

Layout as specified above. No changes.

### Tablet Landscape (1024px - 1439px)

- Left rail collapses to dropdown in header
- Globe and right rail remain side-by-side
- Telemetry cards stay 4 across (shrink to fit)

### Tablet Portrait (768px - 1023px)

- Single column layout
- Globe: full width, 400px fixed height
- Right rail: full width below globe
- Telemetry: 2×2 grid
- Alert log: full width

### Mobile (< 768px)

- Globe: full width, 300px fixed height
- All panels stack vertically
- Telemetry: 2×2 grid with smaller cards
- Header: collapse status + clock to icons only
- Agent chat: collapsible panel (default closed)

## Design Tokens Reference

```css
/* Spacing */
--space-2xs: 2px;
--space-xs: 4px;
--space-sm: 8px;
--space-md: 12px;
--space-lg: 16px;
--space-xl: 20px;
--space-2xl: 24px;
--space-3xl: 32px;

/* Border radius */
--radius-sm: 4px;
--radius-md: 8px;
--radius-lg: 12px;
--radius-full: 9999px;

/* Shadows (use sparingly) */
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
--shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
--shadow-focus: 0 0 0 2px rgba(255, 107, 53, 0.2);

/* Z-index layers */
--z-base: 0;
--z-dropdown: 100;
--z-modal: 200;
--z-toast: 300;
--z-tooltip: 400;
```

## Implementation Notes

**CSS approach:** CSS Modules + design tokens

```typescript
// globals.css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=Playfair+Display:ital,wght@0,400;0,500;1,400;1,500&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  /* All tokens defined here */
}

// Component.module.css
.header {
  height: 56px;
  background: var(--color-bg-primary);
  border-bottom: 1px solid var(--color-border-tertiary);
  padding: 0 var(--space-xl);
}

.brandMark {
  font-family: var(--font-serif);
  font-size: 15px;
  font-weight: 500;
  font-style: italic;
  color: var(--color-text-primary);
}
```

**No CSS-in-JS:** Use CSS Modules for scoping, CSS variables for theming. Avoid runtime style generation (performance overhead).

**Globe library constraints:**
- globe.gl provides its own styling for Three.js canvas
- We control wrapper div only
- Override default colors via props, not CSS

**Recharts customization:**
- Use `<ResponsiveContainer>` to fit parent
- Custom stroke colors via `stroke` prop
- Disable animations if `prefers-reduced-motion`
