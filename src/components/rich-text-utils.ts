export const FONT_SIZES = [
  { value: '10', label: '10' },
  { value: '11', label: '11' },
  { value: '12', label: '12' },
  { value: '14', label: '14' },
  { value: '16', label: '16' },
  { value: '18', label: '18' },
  { value: '20', label: '20' },
  { value: '24', label: '24' },
  { value: '28', label: '28' },
  { value: '32', label: '32' },
  { value: '36', label: '36' },
];

export const FONT_SIZE_STEPS = FONT_SIZES.map((size) => Number(size.value));

export const DEFAULT_FONT_SIZE = 12;

export const pxToPt = (px: number) => Math.round((px * 72) / 96);

export const findNearestFontSize = (value: number) => {
  let closest = FONT_SIZE_STEPS[0];
  let minDiff = Math.abs(value - closest);
  for (const option of FONT_SIZE_STEPS) {
    const diff = Math.abs(value - option);
    if (diff < minDiff) {
      minDiff = diff;
      closest = option;
    }
  }
  return closest;
};
