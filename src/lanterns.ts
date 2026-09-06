import type { ConfluenceId, HarborLanternId } from './types';

export type { HarborLanternId } from './types';

export type HarborLanternAnchor = 'courtyard' | 'table' | 'lookout' | 'clock-tower' | 'ferry-dock';

export type HarborLanternDefinition = Readonly<{
  id: HarborLanternId;
  title: string;
  mark: string;
  anchor: HarborLanternAnchor;
  confluenceIds: readonly ConfluenceId[];
  achievement: string;
}>;

export type HarborLanternState = HarborLanternDefinition & Readonly<{
  state: 'waiting' | 'stirring' | 'ready' | 'lit';
  activeConfluences: readonly ConfluenceId[];
}>;

export type HarborLanternContext = Readonly<{
  knownConfluences?: Iterable<ConfluenceId>;
  activeConfluences?: Iterable<ConfluenceId>;
  litLanterns?: Iterable<HarborLanternId>;
}>;

export const HARBOR_LANTERNS: readonly HarborLanternDefinition[] = [
  {
    id: 'blossom',
    title: 'Blossom Lantern',
    mark: '✿',
    anchor: 'courtyard',
    confluenceIds: ['tide-sanctuary', 'banner-guild'],
    achievement: 'Hold a Tide Sanctuary and Banner Guild in the same town.',
  },
  {
    id: 'table',
    title: 'Table Lantern',
    mark: '⌂',
    anchor: 'table',
    confluenceIds: ['house-of-hands'],
    achievement: 'Raise a House of Hands from an arcade, courtyard garden, and stepped terrace.',
  },
  {
    id: 'chorus',
    title: 'Chorus Lantern',
    mark: '♪',
    anchor: 'lookout',
    confluenceIds: ['celestial-beacon'],
    achievement: 'Raise a Celestial Beacon over a high crossing and hanging roof garden.',
  },
  {
    id: 'clock',
    title: 'Clock Lantern',
    mark: '◷',
    anchor: 'clock-tower',
    confluenceIds: ['archive-tower'],
    achievement: 'Raise an Archive Tower from an arcade, courtyard garden, and lookout.',
  },
  {
    id: 'welcome',
    title: 'Welcome Lantern',
    mark: '⇝',
    anchor: 'ferry-dock',
    confluenceIds: ['grand-exchange'],
    achievement: 'Join a water crossing, arcade, and harbor plaza into a Grand Exchange.',
  },
] as const;

export const HARBOR_LANTERN_BY_ID = new Map(HARBOR_LANTERNS.map((lantern) => [lantern.id, lantern]));

export function harborLanternStates(context: HarborLanternContext): readonly HarborLanternState[] {
  const knownConfluences = context.knownConfluences instanceof Set
    ? context.knownConfluences
    : new Set(context.knownConfluences ?? []);
  const activeConfluences = context.activeConfluences instanceof Set
    ? context.activeConfluences
    : new Set(context.activeConfluences ?? []);
  const litLanterns = context.litLanterns instanceof Set ? context.litLanterns : new Set(context.litLanterns ?? []);
  return HARBOR_LANTERNS.map((lantern) => Object.freeze({
    ...lantern,
    activeConfluences: Object.freeze(lantern.confluenceIds.filter((id) => activeConfluences.has(id))),
    state: litLanterns.has(lantern.id)
      ? 'lit'
      : lantern.confluenceIds.every((id) => activeConfluences.has(id))
        ? 'ready'
        : lantern.confluenceIds.some((id) => knownConfluences.has(id) || activeConfluences.has(id))
          ? 'stirring'
          : 'waiting',
  }));
}

export function litHarborLanterns(context: HarborLanternContext) {
  return harborLanternStates(context).filter((lantern) => lantern.state === 'lit');
}

export function harborLanternsCompletedByEdit(
  previousActiveConfluences: Iterable<ConfluenceId>,
  activeConfluences: Iterable<ConfluenceId>,
  litLanterns: Iterable<HarborLanternId> = [],
) {
  const previous = previousActiveConfluences instanceof Set
    ? previousActiveConfluences
    : new Set(previousActiveConfluences);
  const active = activeConfluences instanceof Set ? activeConfluences : new Set(activeConfluences);
  const lit = litLanterns instanceof Set ? litLanterns : new Set(litLanterns);
  return HARBOR_LANTERNS.filter((lantern) =>
    !lit.has(lantern.id)
    && lantern.confluenceIds.every((id) => active.has(id))
    && !lantern.confluenceIds.every((id) => previous.has(id)));
}
