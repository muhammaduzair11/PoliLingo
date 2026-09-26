/**
 * Every console route, built in one place (docs/platform.md 4.3), so a link
 * and the page it points at cannot drift apart. Ids are encoded; they are
 * permanent content ids (ps-itm-7f3a91) and never need it, but a token or a
 * next path might.
 */
const seg = (value: string) => encodeURIComponent(value);

/**
 * The request header the proxy sets to the path and query being opened, so
 * a server layout (which is not told its path) can build /sign-in?next=….
 */
export const PATH_HEADER = 'x-polilingo-path';

export const consoleRoots = {
  review: '/review',
  edit: '/edit',
  admin: '/admin',
} as const;

export const reviewQueuePath = () => '/review';
export const reviewItemPath = (itemId: string) => `/review/item/${seg(itemId)}`;
export const reviewLessonPath = (lessonId: string) =>
  `/review/lesson/${seg(lessonId)}`;

export const editTreePath = () => '/edit';
export const editLessonPath = (lessonId: string) =>
  `/edit/lesson/${seg(lessonId)}`;

export const adminOverviewPath = () => '/admin';
export const adminPeoplePath = () => '/admin/people';
export const adminSuggestionsPath = () => '/admin/suggestions';
export const adminPublishPath = () => '/admin/publish';

export const invitePath = (token: string) => `/invite/${seg(token)}`;
export const accountPath = () => '/account';
export const learnPath = () => '/learn';

/**
 * /sign-in?next=<path>. `next` must be a same-origin path; anything else is
 * dropped here as well as by the sign-in page's own safeNext().
 */
export function signInPath(next?: string | null): string {
  if (!next || !/^\/(?![/\\])/.test(next)) return '/sign-in';
  return `/sign-in?next=${encodeURIComponent(next)}`;
}
