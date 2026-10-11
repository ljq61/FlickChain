import firstFlick from '../../public/levels/01-first-flick.json';
import distance from '../../public/levels/02-distance.json';
import corner from '../../public/levels/03-turn-the-corner.json';
import zigzag from '../../public/levels/04-zigzag.json';
import fullChain from '../../public/levels/05-full-chain.json';
import { validateLevel } from './LevelValidator';
import type { LevelConfig } from '../types/contracts';

// One JSON source per level, checked at the same boundary as external content.
export const LEVELS: LevelConfig[] = [firstFlick, distance, corner, zigzag, fullChain].map((level) => validateLevel(level));
