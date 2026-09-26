/**
 * The learning map (/learn/<course>), worked out from however many lessons
 * the content release gives a course. Nothing here assumes a number of
 * lessons: the map was drawn for three, and these keep exactly that drawing
 * for three while fitting one, eight or any other number.
 */
import { lessonKey } from './progress.ts';

type CourseLessons = { id: string; lessons: { id: string }[] };

/** Where a learner is in one course. */
export type CourseProgress = {
  /** Lessons of this release the learner has completed. */
  done: number;
  /** Lessons the course has in this release. */
  total: number;
  /** Every lesson completed: the course's badge is earned. False for a course with none. */
  finished: boolean;
  /** The first lesson not yet completed, or the first lesson once all are. Undefined only with no lessons. */
  next: { id: string } | undefined;
};

/**
 * Counts only the lessons the course has in this release. A completion kept
 * for a lesson the release no longer has is not counted, so a retired lesson
 * never makes a course look finished, and a new one un-finishes it.
 */
export function courseProgress(
  completed: Record<string, string>,
  course: CourseLessons,
): CourseProgress {
  const isDone = (l: { id: string }) => !!completed[lessonKey(course.id, l.id)];
  const total = course.lessons.length;
  const done = course.lessons.filter(isDone).length;
  return {
    done,
    total,
    finished: total > 0 && done === total,
    next: course.lessons.find((l) => !isDone(l)) ?? course.lessons[0],
  };
}

/** The icon on a lesson's stop: a star to start, a flag at the end, hearts between. */
export function stopIcon(
  index: number,
  total: number,
): 'star' | 'heart' | 'flag' {
  if (index === 0) return 'star';
  return index === total - 1 ? 'flag' : 'heart';
}

/**
 * The class that places a lesson's stop across the map. The three positions
 * repeat, so the path zig-zags the same way however long it is.
 */
export const stopClass = (index: number) => `stop-${index % 3}`;

// The dotted path behind the stops, in the units of its SVG viewBox, which
// is 400 wide. The path starts beside the first stop and ends at the trophy,
// one stop's distance (PITCH) after the last. The map was drawn for three
// stops as one S-shaped segment and a bend to the right:
//   M190 25 C390 120 35 160 145 265 S350 360 210 490
// Longer maps carry on with bends alternately to the left and right, two for
// every three stops, as the drawing has. The bends are then stretched or
// squeezed together, evenly, so the path still ends at the trophy.
const START = { x: 190, y: 25 };
const PITCH = 155;
/** The drawing's space below the path's end, from its viewBox height of 530. */
const BELOW = 530 - (START.y + 3 * PITCH);
/** Each segment: its control point and end, relative to where it starts in y. */
const OPENING = { c1: [390, 95], c2: [35, 135], end: [145, 240] } as const;
const BENDS = [
  { c2: [350, 95], end: [210, 225] },
  { c2: [35, 135], end: [145, 240] },
] as const;
/**
 * Where the trophy sits across the drawing: centred under the map, where the
 * drawing for three ends. The last segment always ends here, whichever bend
 * it is, so the path meets the trophy for any number of stops.
 */
export const TROPHY_X = BENDS[0].end[0];

const num = (n: number) => String(Math.round(n * 10) / 10);

/**
 * The path's `d` and its viewBox height for a map of `stops` lessons. For
 * three it is the original drawing, exactly.
 */
export function mapPath(stops: number): { d: string; height: number } {
  const n = Math.max(1, Math.floor(stops));
  const segments = Math.max(1, Math.round((2 * n) / 3));
  const heights = [
    OPENING.end[1],
    ...Array.from(
      { length: segments - 1 },
      (_, i) => BENDS[i % BENDS.length].end[1],
    ),
  ];
  const scale = (n * PITCH) / heights.reduce((a, b) => a + b, 0);
  let y = START.y;
  const at = (x: number, dy: number) => `${num(x)} ${num(y + dy * scale)}`;
  // A segment's end: its own, or the trophy's for the last segment.
  const endX = (x: number, i: number) => (i === segments - 1 ? TROPHY_X : x);
  const parts = [`M${START.x} ${START.y}`];
  parts.push(
    `C${at(OPENING.c1[0], OPENING.c1[1])} ${at(OPENING.c2[0], OPENING.c2[1])} ${at(endX(OPENING.end[0], 0), OPENING.end[1])}`,
  );
  y += OPENING.end[1] * scale;
  for (let i = 1; i < segments; i++) {
    const bend = BENDS[(i - 1) % BENDS.length];
    parts.push(
      `S${at(bend.c2[0], bend.c2[1])} ${at(endX(bend.end[0], i), bend.end[1])}`,
    );
    y += bend.end[1] * scale;
  }
  return { d: parts.join(' '), height: START.y + n * PITCH + BELOW };
}
