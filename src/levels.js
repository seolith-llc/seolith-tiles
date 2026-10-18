// src/levels.js
// Viral Micro-Tile Vault Levels & Customizable Screen/Theme Presets

export const LEVEL_PRESETS = [
  {
    id: 0,
    name: '01. The Diagonal Chimney',
    inspiration: 'Inspired by @iwhale / @hiroku1122 viral vault (#2111454912072806784)',
    defaultGrid: 64,
    recommendedAimDeg: 25,
    description:
      'Thread your shot up the narrow right-hand vertical shaft, ricochet down the 45° chute, and detonate the gold-lined inner chamber!',
  },
  {
    id: 1,
    name: '02. The Center Bent Pipe',
    inspiration: 'Inspired by @iwhale / @varreldept viral vault (#2110821987052634247)',
    defaultGrid: 56,
    recommendedAimDeg: -2,
    description:
      'Aim straight into the central pipe, bank off the 45° knee into the 3 gold trigger blocks, and watch 2,800+ orange tiles evaporate!',
  },
  {
    id: 2,
    name: '03. Twin Helix Reactor',
    inspiration: 'Dual-shaft symmetrical vault with a diamond gold core',
    defaultGrid: 64,
    recommendedAimDeg: -22,
    description:
      'Infiltrate either the left or right reactor shaft to reach the diamond gold core and unleash a 1,500-ball chain reaction.',
  },
  {
    id: 3,
    name: '04. Seolith Citadel',
    inspiration: 'High-density deep chimney with layered gold veins',
    defaultGrid: 72,
    recommendedAimDeg: 0,
    description:
      '5,000+ micro-tiles with embedded gold veins. Pierce the central spire to flood the upper vault from the top down!',
  },
];

export const VISUAL_THEMES = {
  crimson_viral: {
    id: 'crimson_viral',
    name: 'Viral Crimson Vault (Post #1)',
    bgHex: '#121316',
    arenaBgHex: '#0b0c0e',
    primaryBrickHex: '#e11922',
    goldBrickHex: '#facc15',
    cyanBrickHex: '#22d3ee',
    armorWallHex: '#868990',
    paddleHex: '#f26a3d',
    ballHex: '#ffffff',
    tiltDeg: 0,
    tileDepth: 0.012,
  },
  sunset_amber: {
    id: 'sunset_amber',
    name: 'Viral Amber Grid (Post #2)',
    bgHex: '#141416',
    arenaBgHex: '#0d0e11',
    primaryBrickHex: '#ea6c1e',
    goldBrickHex: '#fde047',
    cyanBrickHex: '#38bdf8',
    armorWallHex: '#7c8087',
    paddleHex: '#f0643b',
    ballHex: '#ffffff',
    tiltDeg: 0,
    tileDepth: 0.012,
  },
  seolith_obsidian: {
    id: 'seolith_obsidian',
    name: 'Seolith 3D Obsidian & Gold',
    bgHex: '#090a0f',
    arenaBgHex: '#050609',
    primaryBrickHex: '#10b981',
    goldBrickHex: '#fbbf24',
    cyanBrickHex: '#818cf8',
    armorWallHex: '#475569',
    paddleHex: '#f59e0b',
    ballHex: '#f8fafc',
    tiltDeg: 14,
    tileDepth: 0.022,
  },
  cyber_neon: {
    id: 'cyber_neon',
    name: 'Cyberpunk Neon 3D',
    bgHex: '#070510',
    arenaBgHex: '#04020a',
    primaryBrickHex: '#ec4899',
    goldBrickHex: '#fde047',
    cyanBrickHex: '#06b6d4',
    armorWallHex: '#64748b',
    paddleHex: '#22d3ee',
    ballHex: '#ffffff',
    tiltDeg: 18,
    tileDepth: 0.025,
  },
};
