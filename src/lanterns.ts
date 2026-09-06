import type { ConfluenceId, HarborLanternId } from './types';

export type { HarborLanternId } from './types';

export type HarborLanternAnchor = 'courtyard' | 'table' | 'lookout' | 'clock-tower' | 'ferry-dock';

export type HarborLanternDefinition = Readonly<{
  id: HarborLanternId;
  title: string;
  mark: string;
  eventId: string;
  awakensOn: string;
  anchor: HarborLanternAnchor;
  confluenceIds: readonly ConfluenceId[];
  promise: string;
}>;

export type HarborLanternState = HarborLanternDefinition & Readonly<{
  state: 'waiting' | 'stirring' | 'ready' | 'lit';
  storyComplete: boolean;
  activeConfluences: readonly ConfluenceId[];
}>;

export type HarborLanternContext = Readonly<{
  discoveries: Iterable<string>;
  knownConfluences?: Iterable<ConfluenceId>;
  activeConfluences?: Iterable<ConfluenceId>;
  litLanterns?: Iterable<HarborLanternId>;
}>;

export const HARBOR_LANTERNS: readonly HarborLanternDefinition[] = [
  {
    id: 'blossom',
    title: 'Blossom Lantern',
    mark: '✿',
    eventId: 'blossom-evening',
    awakensOn: 'sheltered-courtyard',
    anchor: 'courtyard',
    confluenceIds: ['tide-sanctuary', 'banner-guild'],
    promise: 'Bring blossom and ceremonial cloth together through the Tide Sanctuary and Banner Guild.',
  },
  {
    id: 'table',
    title: 'Table Lantern',
    mark: '⌂',
    eventId: 'shared-supper',
    awakensOn: 'familiar-faces',
    anchor: 'table',
    confluenceIds: ['house-of-hands'],
    promise: 'Let old friends share supper, then raise the House of Hands for the whole town.',
  },
  {
    id: 'chorus',
    title: 'Chorus Lantern',
    mark: '♪',
    eventId: 'evening-chorus',
    awakensOn: 'gulls-return',
    anchor: 'lookout',
    confluenceIds: ['celestial-beacon'],
    promise: 'Hear the harbor chorus, then give its sea and sky a Celestial Beacon.',
  },
  {
    id: 'clock',
    title: 'Clock Lantern',
    mark: '◷',
    eventId: 'clock-tower',
    awakensOn: 'tower-bell',
    anchor: 'clock-tower',
    confluenceIds: ['archive-tower'],
    promise: 'Fit the harbor clock, then build an Archive Tower to keep the town\'s time.',
  },
  {
    id: 'welcome',
    title: 'Welcome Lantern',
    mark: '⇝',
    eventId: 'ferry-route',
    awakensOn: 'last-lantern',
    anchor: 'ferry-dock',
    confluenceIds: ['grand-exchange'],
    promise: 'Welcome the last ferry, then join its route to the Grand Exchange.',
  },
] as const;

export const HARBOR_LANTERN_BY_EVENT = new Map(HARBOR_LANTERNS.map((lantern) => [lantern.eventId, lantern]));
export const HARBOR_LANTERN_BY_ID = new Map(HARBOR_LANTERNS.map((lantern) => [lantern.id, lantern]));

export function harborLanternStates(context: HarborLanternContext): readonly HarborLanternState[] {
  const known = context.discoveries instanceof Set ? context.discoveries : new Set(context.discoveries);
  const knownConfluences = context.knownConfluences instanceof Set
    ? context.knownConfluences
    : new Set(context.knownConfluences ?? []);
  const activeConfluences = context.activeConfluences instanceof Set
    ? context.activeConfluences
    : new Set(context.activeConfluences ?? []);
  const litLanterns = context.litLanterns instanceof Set ? context.litLanterns : new Set(context.litLanterns ?? []);
  return HARBOR_LANTERNS.map((lantern) => Object.freeze({
    ...lantern,
    storyComplete: known.has(lantern.eventId),
    activeConfluences: Object.freeze(lantern.confluenceIds.filter((id) => activeConfluences.has(id))),
    state: litLanterns.has(lantern.id)
      ? 'lit'
      : known.has(lantern.eventId) && lantern.confluenceIds.every((id) => activeConfluences.has(id))
        ? 'ready'
        : known.has(lantern.awakensOn) || known.has(lantern.eventId) || lantern.confluenceIds.some((id) => knownConfluences.has(id))
          ? 'stirring'
          : 'waiting',
  }));
}

export function litHarborLanterns(context: HarborLanternContext) {
  return harborLanternStates(context).filter((lantern) => lantern.state === 'lit');
}
