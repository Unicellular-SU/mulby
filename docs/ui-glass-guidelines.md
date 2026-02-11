# Mulby Glassmorphism UI/UX Standard

This standard applies to **app-owned surfaces** only (search window, settings, plugin management, toolbars). Plugin UIs are allowed to define their own design language and are not required to follow these styles.

Sources: ui-ux-pro-max style + UX guidelines (glassmorphism, contrast, accessibility).

---

## 1) Design Principles

- **Clarity first:** Text contrast must stay ≥ 4.5:1 on glass layers.
- **Layered depth:** Use 2–3 layers maximum (base shell, section card, control).
- **Controlled transparency:** Glass surfaces must remain readable in light/dark.
- **Consistent tokens:** All glass surfaces use the same blur, border, and shadow scale.

---

## 2) Color & Glass Tokens

### Light

```
--glass-bg: rgba(255, 255, 255, 0.78)
--glass-bg-strong: rgba(255, 255, 255, 0.88)
--glass-border: rgba(255, 255, 255, 0.55)
--glass-shadow: 0 12px 30px rgba(15, 23, 42, 0.12)

--glass-accent: rgba(59, 130, 246, 0.6)
--glass-accent-bg: rgba(219, 234, 254, 0.6)
```

### Dark

```
--glass-bg: rgba(15, 23, 42, 0.72)
--glass-bg-strong: rgba(15, 23, 42, 0.84)
--glass-border: rgba(148, 163, 184, 0.18)
--glass-shadow: 0 16px 32px rgba(0, 0, 0, 0.35)

--glass-accent: rgba(59, 130, 246, 0.7)
--glass-accent-bg: rgba(30, 58, 138, 0.35)
```

### Blur

```
--glass-blur: 16px
--glass-blur-strong: 20px
```

---

## 3) Layout & Spacing

- **Main shell radius:** 12px
- **Card radius:** 16px
- **Chip radius:** 999px
- **Vertical rhythm:** 12 / 16 / 20 px increments
- **Touch targets:** ≥ 44x44 px

---

## 4) Component Standards

### 4.1 Search Window (Main)

- Container: glass surface
- Fixed height: 62px
- Padding: `0 18px`
- Input font: 17px, line-height 1.3
- Icon: 20px, stroke 2

### 4.2 Settings Shell

- Background: layered gradients + glass base
- Sidebar: glass surface, border-right glass
- Sections: glass cards with clear separation

### 4.3 Buttons

- Use glass buttons for secondary actions
- Primary button: accent border + stronger background
- Hover only changes color/border, no scale

### 4.4 Chips (Filters, Toggles)

- Rounded pill, fixed min width 72px
- Active uses `--glass-accent-bg`
- Avoid tight packing; use grid layout for filters

### 4.5 Plugin List (Settings)

- Each row is a glass card
- Icon size: 40px, radius 12px
- Action group wraps to new line on narrow width
- Status badges: pill with solid contrast

---

## 5) Motion & Interaction

- Duration: 150–200ms
- Use opacity + color transitions only
- Respect prefers-reduced-motion
- Focus ring: 2px accent + offset 2px

---

## 6) Accessibility Checklist

- Contrast ≥ 4.5:1 for text
- Focus-visible on all interactive elements
- No emoji icons; use SVG
- Icon-only buttons must have aria-label

---

## 7) Scope Rules

Applies to:
- Main search window
- Settings panels
- Plugin management UI
- Built-in toolbars / in-app panels

Does not apply to:
- Plugin UI content (plugins own their UI)
