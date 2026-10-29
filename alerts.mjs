export const STATION_MS = 660000;
/** Return only the most recent crossed cue, so returning from the background never plays stale cues in a burst. */
export function latestAlert(from, to) {
  if (to <= from) return null;
  const cycle = Math.floor(to / STATION_MS);
  let latest = null;
  for (let c = Math.max(0, cycle - 1); c <= cycle; c++) {
    const offset = c * STATION_MS;
    const points = [
      {at: offset, text: `第 ${c + 1} 輪，請換站並閱讀下一題，時間 1 分鐘。`, kind: 'notice'},
      {at: offset + 60000, text: '讀題結束，請開始作答，時間 8 分鐘。', kind: 'notice'},
      {at: offset + 480000, text: '作答已經過 7 分鐘，剩下 1 分鐘。', kind: 'notice'},
      {at: offset + 540000, text: '作答時間到，請停止作答，開始回饋，時間 2 分鐘。', kind: 'end'}
    ];
    for (const point of points) if (point.at > from && point.at <= to) latest = point;
  }
  return latest;
}
