import { describe, expect, it } from 'vitest';
import { mix, shareBreaks, shareStep } from '../src/lib/color';

describe('vote-share steps', () => {
  it('cuts at sixths and the top 5%, so each step holds about as many areas', () => {
    const values = Array.from({ length: 101 }, (_, i) => i / 100);
    expect(shareBreaks(values)).toEqual([0.17, 0.33, 0.5, 0.67, 0.83, 0.95]);
    expect(shareStep([0.2, 0.4], 0.2)).toBe(0); // steps run (lower, upper]
    expect(shareStep([0.2, 0.4], 0.3)).toBe(1);
    expect(shareStep([0.2, 0.4], 0.9)).toBe(2);
  });

  it('merges breaks that fall on the same share', () => {
    expect(shareBreaks([0, 0, 0, 0, 0, 0, 0, 0.5])).toEqual([0]);
    expect(shareBreaks([])).toEqual([]);
  });

  it('mixes colors end to end', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
  });
});
