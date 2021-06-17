import { useCallback, useEffect, useRef, useState } from "react";
import * as SQLite from 'expo-sqlite';
import { SQLResultSet } from "expo-sqlite";
import { v4 as uuidv4 } from 'uuid';


export async function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function useEffectAsync(fn: () => Promise<void>, deps: any[]) {
  useEffect(() => {
    fn();
  }, deps);
}

export function createCleanItem<C extends Record<string, V>, V extends string>(columnDefinitions: C, pk: keyof C) {

  type TItem = SqlObj<C>
  const columns = Object.keys(columnDefinitions) as Array<keyof TItem>;
  const cleanColumns = columns.filter(o => !excludedColumn.includes(o as keyof PrivateFields));
  return function cleanItem(item: TItem, includePrimaryKey: boolean) {
    let result = {} as TItem;
    for (const key of cleanColumns) {
      if(key == pk && !includePrimaryKey) continue;
      if(item[key] == null) continue;
      result[key] = item[key];
    }
    return result;
  }
}

export function executeSqlOnDb(db: SQLite.WebSQLDatabase, query: string, args?: any[]): Promise<SQLResultSet> {
  return new Promise<SQLResultSet>((resolve, reject) => {
    db.transaction(tx => tx.executeSql(query, args, (_, result) => {
      resolve(result)
    }, (_, err) => { reject(err); return true; }))
  });
}

export type JsonObject<T> = "object" & { interface: T};
export function jsonObject<T>(): JsonObject<T> { return "object" as any; }
export type OptionalJsonObject<T> = "object?" & { interface: T};
export function optionalJsonObject<T>(): OptionalJsonObject<T> { return "object?" as any; }

type SqlObjProperty<T> = T extends "number" ? number :
  T extends "integer" ? number :
  T extends "unsigned big int" ? number :
  T extends "string" ? string :
  T extends "text" ? string :
  T extends "bit" ? 1 | 0 :
  T extends "boolean" ? boolean :
  T extends "date" ? Date :
  T extends JsonObject<infer U> ? U:
  T extends OptionalJsonObject<infer U> ? U:
  T extends Optional<infer B> ? SqlObjProperty<B>:
  unknown

type Optional<S extends string> = `${S}?`

function debugLogging(...a: Parameters<typeof console['log']>) {
  // debugLogging(...a);
}

export type SqlObj<T extends Record<string, string>> = {} & {
  -readonly [P in keyof T as T[P] extends Optional<string> ? never : P]:  SqlObjProperty<T[P]>
} & {
  -readonly [P in keyof T as T[P] extends Optional<string> ? P : never]?:  SqlObjProperty<T[P]>
} & {
  modifiedDate: number
}

const excludedColumn: Array<keyof PrivateFields> = [ "_localModified", "_localModifiedDate", "_localDelete"];
type PrivateFields = {
  _localModified: 0 | 1,
  _localModifiedDate: number,
  _localDelete: 0 | 1
}

// T: Move all sql stuff in here including insert/update/delete so we can cache common sql creation
export function createSyncFunctions<C extends Record<string, V>, V extends string, PK extends keyof SqlObj<C>>(tableName: string, columnDefinitions: C, pk: PK, api: {
  insert: (value: SqlObj<C>) => Promise<SqlObj<C>>
  update: (value: SqlObj<C>) => Promise<SqlObj<C>>
  delete: (value: SqlObj<C>) => Promise<void>
  get: (filter: Partial<SqlObj<C>>) => Promise<Array<SqlObj<C> & { modifiedDate: number, localId: string }>>
  getById: (id: SqlObj<C>[PK]) => Promise<SqlObj<C> & { modifiedDate: number, localId: string }>
  getDeletions: (lastSeenDeletion: number) => Promise<Array<SqlObj<C> & { modifiedDate: number, localId: string }>>
  hydrationMapper?: (item: SqlObj<C>) => SqlObj<C>
}) {
  let columnDefinitionsLocal = {
    ...columnDefinitions,
    _localModified: 'bit',
    _localModifiedDate: 'number',
    _localDelete: 'bit'
  } as Record<keyof SqlObj<C>, string>;
  let objectColumns = Object.entries(columnDefinitionsLocal).filter(([k, v]) => v === "object" || v === "object?").map(([k, v]) => k);
  let hydrationMapper = api.hydrationMapper ?? ((o) => o)
  debugLogging("createSyncFunctions", {
    columnDefinitionsLocal,
    objectColumns
  })
  let knownFailedItemCount = 0;
  let ongoingOperationCount = 0;

  const db = SQLite.openDatabase('api');
  const executeSql = async (query: string, args: any[], logWarning = true) => {
    try {
      debugLogging("executeSql", { query, args });
      return await executeSqlOnDb(db, query, args);
    }catch (e) {
      if(logWarning) {
        console.warn("!ERROR executeSql", { query, args,  e });
      }
      throw e;
    }
  }
  const columns = Object.keys(columnDefinitionsLocal) as Array<keyof TItem>;
  let setLocalQueryPartialQuery = columns.map(() => '?').join(', ');
  function getType(key: keyof SqlObj<C>) {
    let type = columnDefinitionsLocal[key];
    debugLogging({key, type});
    if(type === "object") type = "text";
    if(type === "object?") type = "text?";

    let columnDefinition = (type.endsWith('?') ? 
      `${type.substr(0, type.length - 1)}` : 
      `${type} NOT NULL`);
      
    return columnDefinition + (key == pk ? " PRIMARY KEY" : "");
  }
  let createTableSql = `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    ${columns.map((key) => `${key} ${getType(key)}`).join(', ')}
  );
`;
  let createDeleteHelperTableSql = `
  CREATE TABLE IF NOT EXISTS lastSeenDeletion (
    tableName string PRIMARY KEY,
    lastSeenDeletionTime number
  );
`;
  const selectQueryById = `SELECT ${columns.join(', ')} from ${tableName} WHERE ${pk} = ?`;
  const selectMinId = `SELECT min(${pk}) as minId from ${tableName}`;
  const selectQuery = `SELECT ${columns.join(', ')} from ${tableName} WHERE 1 = 1`;
  const insertQuery = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${setLocalQueryPartialQuery});`
  const updateQuery = `UPDATE ${tableName} SET ${columns
      .map(c => `${c} = ?`)
      .join(', ')
    } WHERE ${pk} = ?;`
  const deleteQuery = `DELETE FROM ${tableName} WHERE ${pk} = ?;`
  let createTablePromise = createTable();
  return {
    getLocal,
    setLocal,
    deleteItem,
    insertItem,
    updateItem,
    useData,
    doSync,
    getById,
    clearAllData,
  };
  type TItem = SqlObj<C>
  type TItemPrivate = TItem & PrivateFields;
  async function createTable() {
    // await executeSql(`DROP TABLE IF EXISTS ${tableName};`, [])
    // await executeSql(`DROP TABLE IF EXISTS lastSeenDeletion;`, [])
    await unsafeCleanAllData();
    await executeSql(createTableSql, [])
    await executeSql(createDeleteHelperTableSql, []);
    try {
      await executeSql(`
      INSERT INTO lastSeenDeletion(tableName,lastSeenDeletionTime)
        VALUES(?, ?); `, [tableName, Date.now()], false)
    } catch(e) {
    }

    debugLogging(await executeSql(`select * from lastSeenDeletion`, []))
  }
  async function unsafeCleanAllData() {
    await executeSql(`DROP TABLE IF EXISTS ${tableName}`, []);
    await executeSql(`DELETE FROM lastSeenDeletion WHERE tableName = ?`, [tableName]);
  }
  async function clearAllData() {
    await createTablePromise;
    createTablePromise = (async function() {
      await unsafeCleanAllData();
      await createTable()
    })();
    await createTablePromise;
  }
  async function syncDeletions() {
    try {
      await createTablePromise;
      const result = await executeSql(`SELECT lastSeenDeletionTime FROM lastSeenDeletion WHERE tableName = ?`, [tableName])
      debugLogging("syncDeletions", result.rows.item(0))
      let lastSeenDeletionTime = result.rows.item(0)["lastSeenDeletionTime"]
      const deletedItems = await api.getDeletions(lastSeenDeletionTime);
      await Promise.all(deletedItems.map(hardDeleteLocalData));
      let maxDate = deletedItems.reduce((v, a)=> Math.max(v, a.modifiedDate), lastSeenDeletionTime);
      await executeSql(`UPDATE lastSeenDeletion SET lastSeenDeletionTime = ?  WHERE tableName = ?`, [maxDate, tableName])
      return lastSeenDeletionTime != maxDate;
    }catch(e) {
      debugLogging(e)
    }
  }
  async function doSync(signal: AbortSignal) {
    await createTablePromise;
    knownFailedItemCount += (await getLocal({ "_localModified": 1 } as any)).length;
    debugLogging(`knownFailedItemCount ${tableName}`, await getLocal({ "_localModified": 1 } as any));
    while (true) {
      if (signal.aborted) return;
      await delay(100);
      if(knownFailedItemCount !== 0) {
        debugLogging(`knownFailedItemCount ${tableName}`, knownFailedItemCount);
      }
      
      if (!knownFailedItemCount) continue;
      // Do not sync while other operations are ongoing 
      if (ongoingOperationCount != 0) continue;
      const modifiedData = (await getLocal({ "_localModified": 1 } as any));
      knownFailedItemCount = modifiedData.length;

      // Maybe an operation has started. 
      if (ongoingOperationCount != 0) continue;

      for (let item of modifiedData as Array<TItemPrivate>) {
        if (signal.aborted) return;
        if (item['_localModified'] != 1) continue;
        try {
          console.log("Trying to sync", item);
          item.modifiedDate = item._localModified;
          if (item['_localDelete']) {
            await api.delete(item)
            await hardDeleteLocalData(item);
          } else if (item[pk] < 0) {
            let serverItem = await api.insert(item);
            await syncLocalItem(item, serverItem);
          } else {
            let serverItem = await api.update(item);
            await syncLocalItem(item, serverItem)
          }
          knownFailedItemCount--;
        } catch (e) {
          debugLogging("Sync failure", e)
        }
      }
    }
  }

  async function getLocal(filter: Partial<TItem>, unInserted = false) {
    await createTablePromise;
    const keys = Object.keys(filter) as Array<keyof TItem>;
    let query = selectQuery;
    let params = []
    for (let key of keys) {
      if (filter[key] === undefined) continue;
      switch (columnDefinitionsLocal[key]) {
        case 'string': 
        case 'string?': 
          if(filter[key] != "") {
            query += ` AND ${key} like '%' + ? + '%'`; 
            params.push(filter[key]);
          }
          break;
        default: 
          query += ` AND ${key} = ?`;
          params.push(filter[key]);
          break;
      }
      
    }
    if(unInserted) {
      query += " AND id < 0"
    }
    debugLogging("getLocal ", query, params);
    let result = await executeSql(query, params);
    debugLogging("getLocal query done");
    let arrayResult = resultToArray(result);
    debugLogging(`local data ${tableName} (${JSON.stringify(filter)}):`, arrayResult.map(o => o /* [pk] */));
    return arrayResult;
  }

  function resultToArray(sqlResult: SQLResultSet): TItem[] {
    let result = new Array<TItem>(sqlResult.rows.length);
    debugLogging("resultToArray", objectColumns);
    for(let i = 0; i< sqlResult.rows.length; i++) {
      let obj = sqlResult.rows.item(i)
      for(let col of objectColumns) {
        debugLogging("resultToArray", col, obj[col]);
        let value = obj[col];
        if(value != null) {
          obj[col] = JSON.parse(value);
        }
      }
      result[i] =  hydrationMapper(obj);
    }
    debugLogging("resultToArray", result);
    return result
  }

  async function setLocal(data: TItem[]) {
    await createTablePromise;

    debugLogging(`setLocal ${tableName}`, data.map(o => o[pk]));
    const finalData = await Promise.all(data.map(async serverItem => {
      let localItem = await getLocalById(serverItem[pk]);
      return await syncLocalItem(localItem, serverItem);
    }));
    return finalData;
  }

  async function getLocalById(id:TItem[PK]) {
    let localItemSet = await executeSql(selectQueryById, [id]);
    let localItem = localItemSet.rows.length !== 1 ? undefined : localItemSet.rows.item(0) as TItem;
    return localItem;
  }

  async function getById(id: TItem[PK]) {
    let item = await getLocalById(id);
    if(item) return item;
    return api.getById(id);
  }

  async function syncLocalItem(localItem: TItem | undefined, serverItem: TItem) {
    const localItemPrivate = localItem as TItemPrivate;

    debugLogging(`syncLocalItem ${tableName}`, {
      localItem,
      serverItem,
      useLocal: localItem && localItemPrivate._localModified && localItemPrivate._localModified > serverItem.modifiedDate
    });

    if (localItem && localItemPrivate._localModified && localItemPrivate._localModified > serverItem.modifiedDate) {
      return localItem;
    } else {
      if (localItem) {
        await updateLocalData(serverItem, false, localItem[pk] as number);
      } else {
        await insertLocalData(serverItem, false);
      }
      return serverItem;
    }
  }

  async function updateLocalData(item: TItem, isLocalModified = true, oldId?: number) {
    await createTablePromise;

    const localItem = {
      ... { _localDelete: 0 },
      ...item,
      _localModifiedDate: Date.now(),
      _localModified: isLocalModified ? 1 : 0
    } as TItem;
    const params: any[] = columns.map(k => dbConvertValue(k, localItem));
    params.push(oldId ?? item[pk]);
    await executeSql(updateQuery, params);
    return localItem;
  }
  function dbConvertValue(column: keyof TItem, obj: TItem) {
    let value = obj[column];
    if (value === undefined) return null;
    if(columnDefinitionsLocal[column] === "object" || columnDefinitionsLocal[column] === "object?") {
      return JSON.stringify(value) as any;
    }
    return value as any;
  }
  async function insertLocalData(item: TItem, isLocalModified = true) {
    await createTablePromise;
    debugLogging("insertLocalData");
    let minId: number = Math.min(0, (await executeSql(selectMinId, [])).rows.item(0)['minId']);

    debugLogging("insertLocalData", minId);
    const localItem: TItem = {
      ...item,
      ...(!isLocalModified ? {
        _localModifiedDate: Date.now(),
        _localModified: 0,
        _localDelete: 0,
      } : {
        [pk]: minId - 1,
        _localModifiedDate: Date.now(),
        _localModified: 1,
        _localDelete: 0,
        _localId: uuidv4()
      })
    };
    let params = columns.map(k => dbConvertValue(k, localItem));
    await executeSql(insertQuery, params);
    return localItem;
  }
  async function hardDeleteLocalData(item: TItem) {
    await executeSql(deleteQuery, [item[pk]]);
  }

  async function softDeleteLocalData(item: TItem) {
    await updateLocalData({
      ...item,
      _localDelete: 1
    })
  }
  async function insertItem(item: TItem) {
    item = await insertLocalData(item);
    ongoingOperationCount++;
    (async function () {
      try {
        const result = await api.insert(item);
        updateLocalData(result, false, item[pk] as number);
      }
      catch (e) {
        debugLogging("Failed update on", item)
        knownFailedItemCount++;
      }
      finally {
        ongoingOperationCount--;
      }
    })();
    return item;
  }
  async function updateItem(item: TItem) {
    let localItem = await updateLocalData(item);
    ongoingOperationCount++;
    (async function () {
      try {
        const result = await (item[pk] < 0 ? api.insert(item) : api.update(item));
        updateLocalData(result, false);
      }
      catch (e) {
        debugLogging("Failed update on", item)
        knownFailedItemCount++;
      }
      finally {
        ongoingOperationCount--;
      }
    })();
    return localItem;
  }

  async function deleteItem(item: TItem) {
    await softDeleteLocalData(item);
    ongoingOperationCount++;
    (async function () {
      try {
        if(item[pk] > 0) {
          await api.delete(item);
        }
        await hardDeleteLocalData(item);
      }
      catch (e) {
        debugLogging("Failed delete on", item)
        knownFailedItemCount++;
      }
      finally {
        ongoingOperationCount--;
      }
    })();
  }

  function useData({ filter = {}, reloadOnFocus = true }: { 
    filter?: Partial<TItem>,
    reloadOnFocus?: boolean,
  }, deps: any[]) {
    const [items, setItems] = useState<TItem[]>([]);
    const [loading, setLoading] = useState(true);
    const serverDataLoading = useRef(true);
    const generation = useRef(0);
    const [errorMessage, setErrorMessage] = useState<string>();

    const loadData = useCallback(async () => {
      serverDataLoading.current = true;
      setErrorMessage(undefined);
      setItems([]);
      let localGen = ++generation.current;

      api.get(filter).then(async (res) => {
        serverDataLoading.current = false;
        const notInserted = getLocal(filter, true);
        const finalResult = await setLocal(res)
        if(localGen != generation.current) return;

        setItems([...await notInserted, ...finalResult]);
        setLoading(false);
      }, err => {
        if(localGen != generation.current) return;
        setErrorMessage(err)
      });

      syncDeletions().then(hasUpdates => {
        // If we have something after deletions, get local data again
        if(hasUpdates) {
          if (serverDataLoading.current && localGen == generation.current) {
            fromLocalData();
          }
        }
      });

      function fromLocalData() {
        getLocal({ ...filter, _localDelete: 0}).then((res) => {
          if(localGen != generation.current) return;
          if (serverDataLoading.current) {
            setItems(res);
            setLoading(false);
          }
        }, err => {
          if(localGen != generation.current) return;
          setErrorMessage(err)
          console.error(err);
        });
      }
      fromLocalData();
    }, deps);

    useEffectAsync(loadData, deps);
    return { items, loading, errorMessage, reload: loadData, setItems };
  }
  
}