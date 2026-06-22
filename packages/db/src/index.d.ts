import postgres from 'postgres';
import * as schema from './schema/index';
export declare function createDb(url: string): import("node_modules/drizzle-orm/postgres-js").PostgresJsDatabase<typeof schema> & {
    $client: postgres.Sql<{}>;
};
export type Db = ReturnType<typeof createDb>;
export * from './schema/index.js';
