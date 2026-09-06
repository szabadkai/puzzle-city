export type HarborLanternId = 'blossom' | 'table' | 'chorus' | 'clock' | 'welcome';

export type HarborLanternAnchor = 'courtyard' | 'table' | 'lookout' | 'clock-tower' | 'ferry-dock';

export type HarborLanternDefinition = Readonly<{
  id: HarborLanternId;
  title: string;
  mark: string;
  eventId: string;
  awakensOn: string;
  anchor: HarborLanternAnchor;
  promise: string;
}>;

export type HarborLanternState = HarborLanternDefinition & Readonly<{
  state: 'waiting' | 'stirring' | 'lit';
}>;

export const HARBOR_LANTERNS: readonly HarborLanternDefinition[] = [
  {
    id: 'blossom',
    title: 'Blossom Lantern',
    mark: '✿',
    eventId: 'blossom-evening',
    awakensOn: 'sheltered-courtyard',
    anchor: 'courtyard',
    promise: 'Let an old courtyard tree bloom, hang festival ribbons, then visit at blue hour.',
  },
  {
    id: 'table',
    title: 'Table Lantern',
    mark: '⌂',
    eventId: 'shared-supper',
    awakensOn: 'familiar-faces',
    anchor: 'table',
    promise: 'Give old friends a cafe or inn where they can share an evening table.',
  },
  {
    id: 'chorus',
    title: 'Chorus Lantern',
    mark: '♪',
    eventId: 'evening-chorus',
    awakensOn: 'gulls-return',
    anchor: 'lookout',
    promise: 'Build a lookout, welcome the gulls back, then listen after 17:30.',
  },
  {
    id: 'clock',
    title: 'Clock Lantern',
    mark: '◷',
    eventId: 'clock-tower',
    awakensOn: 'tower-bell',
    anchor: 'clock-tower',
    promise: 'A patient maker must fit a clock below the nest on the bell tower.',
  },
  {
    id: 'welcome',
    title: 'Welcome Lantern',
    mark: '⇝',
    eventId: 'ferry-route',
    awakensOn: 'last-lantern',
    anchor: 'ferry-dock',
    promise: 'Keep an inn open by the water until a ferry finds its light after dark.',
  },
] as const;

export const HARBOR_LANTERN_BY_EVENT = new Map(HARBOR_LANTERNS.map((lantern) => [lantern.eventId, lantern]));
export const HARBOR_LANTERN_BY_ID = new Map(HARBOR_LANTERNS.map((lantern) => [lantern.id, lantern]));

export function harborLanternStates(discoveries: Iterable<string>): readonly HarborLanternState[] {
  const known = discoveries instanceof Set ? discoveries : new Set(discoveries);
  return HARBOR_LANTERNS.map((lantern) => Object.freeze({
    ...lantern,
    state: known.has(lantern.eventId) ? 'lit' : known.has(lantern.awakensOn) ? 'stirring' : 'waiting',
  }));
}

export function litHarborLanterns(discoveries: Iterable<string>) {
  return harborLanternStates(discoveries).filter((lantern) => lantern.state === 'lit');
}
