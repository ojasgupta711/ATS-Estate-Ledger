/** Clients in alphabetical order by estate name (A → Z, ignoring case). */
export function sortClients<T extends { estateName: string; name: string }>(clients: T[]): T[] {
  return [...clients].sort((a, b) => a.estateName.localeCompare(b.estateName, 'en', { sensitivity: 'base', numeric: true }) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}
