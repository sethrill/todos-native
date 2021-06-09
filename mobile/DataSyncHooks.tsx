import { useCallback, useEffect, useRef, useState } from "react";
import * as SQLite from 'expo-sqlite';
import { SQLResultSet } from "expo-sqlite";


export async function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function useEffectAsync(fn: () => Promise<void>, deps: any[]) {
  useEffect(() => {
    fn();
  }, deps);
}

export function executeSqlOnDb(db: SQLite.WebSQLDatabase, query: string, args?: any[]): Promise<SQLResultSet> {
  return new Promise<SQLResultSet>((resolve, reject) => {
    db.transaction(tx => tx.executeSql(query, args, (_, result) => {
      resolve(result)
    }, (_, err) => { reject(err); return true; }))
  });
}

type SqlObj<T> = {} & {
  [P in keyof T]:
  T[P] extends "number" ? number :
  T[P] extends "string" ? string :
  T[P] extends "bit" ? 1 | 0 :
  T[P] extends "date" ? Date :
  unknown
}
// T: Move all sql stuff in here including insert/update/delete so we can cache common sql creation
export function createSyncFunctions<C extends Record<string, V>, V extends string, PK extends keyof C>(tableName: string, columnDefinitions: C, pk: PK, api: {
  insert: (value: SqlObj<C>) => Promise<SqlObj<C>>
  update: (value: SqlObj<C>) => Promise<SqlObj<C>>
  delete: (value: SqlObj<C>) => Promise<void>
  get: (filter: Partial<SqlObj<C>>) => Promise<Array<SqlObj<C> & { modifiedDate: number }>>
  getById: (id: SqlObj<C>[PK]) => Promise<SqlObj<C> & { modifiedDate: number }>
  getDeletions: (lastSeenDeletion: number) => Promise<Array<SqlObj<C> & { modifiedDate: number }>>
}) {
  columnDefinitions = {
    ...columnDefinitions,
    _localModified: 'bit',
    _localModifiedDate: 'number',
    _localDelete: 'bit'
  };

  let knownFailedItemCount = 0;
  let ongoingOperationCount = 0;

  const db = SQLite.openDatabase('api');
  const executeSql = async (query: string, args: any[]) => {
    try {
      console.log("executeSql", { query, args });
      return await executeSqlOnDb(db, query, args);
    }catch (e) {
      console.log(e);
      throw e;
    }
  }
  const columns = Object.keys(columnDefinitions);
  let setLocalQueryPartialQuery = columns.map(() => '?').join(', ');
  let createTableSql = `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    ${columns.map((key) => `${key} ${columnDefinitions[key]}`).join(', ')}
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
  const createTablePromise = createTable();
  return {
    getLocal,
    setLocal,
    deleteItem,
    insertItem,
    updateItem,
    useData,
    doSync
  };
  type TItem = SqlObj<C>
  async function createTable() {
    // await executeSql(`DROP TABLE IF EXISTS ${tableName};`, [])
    // await executeSql(`DROP TABLE IF EXISTS lastSeenDeletion;`, [])
    await executeSql(createTableSql, [])
    await executeSql(createDeleteHelperTableSql, []);
    try {
      await executeSql(`
      INSERT INTO lastSeenDeletion(tableName,lastSeenDeletionTime)
        VALUES(?, ?); `, [tableName, Date.now()])
    } catch(e) {
      console.log(e);
    }

    console.log(await executeSql(`select * from lastSeenDeletion`, []))
  }

  
  async function syncDeletions() {
    try {
      await createDeleteHelperTableSql;
      const result = await executeSql(`SELECT lastSeenDeletionTime FROM lastSeenDeletion WHERE tableName = ?`, [tableName])
      console.log("syncDeletions", result.rows.item(0))
      let lastSeenDeletionTime = result.rows.item(0)["lastSeenDeletionTime"]
      const deletedItems = await api.getDeletions(lastSeenDeletionTime);
      await Promise.all(deletedItems.map(hardDeleteLocalData));
      let maxDate = deletedItems.reduce((v, a)=> Math.max(v, a.modifiedDate), lastSeenDeletionTime);
      await executeSql(`UPDATE lastSeenDeletion SET lastSeenDeletionTime = ?  WHERE tableName = ?`, [maxDate, tableName])
      return lastSeenDeletionTime != maxDate;
    }catch(e) {
      console.log(e)
    }
  }
  async function doSync() {
    await createTablePromise;
    knownFailedItemCount += (await getLocal({ "_localModified": 1 } as any)).length;
    while (true) {
      await delay(1000);
      if (!knownFailedItemCount) continue;
      // Do not sync while other operations are ongoing 
      if (ongoingOperationCount != 0) continue;
      const modifiedData = (await getLocal({ "_localModified": 1 } as any));

      // Maybe an operation has started. 
      if (ongoingOperationCount != 0) continue;

      knownFailedItemCount = modifiedData.length;
      console.log(knownFailedItemCount);
      for (let item of modifiedData) {
        if (item['_localModified'] != 1) continue;
        try {
          if (item['_localDelete']) {
            await api.delete(item)
            await hardDeleteLocalData(item);
          } else if (item[pk] < 0) {
            let serverItem = await api.insert(item);
            syncLocalItem(item, serverItem);
          } else {
            let serverItem = await api.update(item);
            syncLocalItem(item, serverItem)
          }
          knownFailedItemCount--;
        } catch (e) {
          console.log("Sync failure", e)
        }
      }
    }
  }

  async function getLocal(filter: Partial<TItem>, unInserted = false) {
    await createTablePromise;
    const keys = Object.keys(filter);
    let query = selectQuery;
    let params = []
    for (let key of keys) {
      if (filter[key] === undefined) continue;
      switch (columnDefinitions[key]) {
        case 'string': 
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
    console.log("getLocal ", query, params);
    let result = await executeSql(query, params);
    console.log("getLocal query done");
    let arrayResult = [...result.rows as any] as TItem[];
    console.table(arrayResult);
    return arrayResult;
  }
  async function setLocal(data: TItem[]) {
    await createTablePromise;

    console.log("setLocal", data);
    const finalData = await Promise.all(data.map(async serverItem => {
      let localItemSet = await executeSql(selectQueryById, [serverItem[pk]]);
      let localItem = localItemSet.rows.length !== 1 ? undefined : localItemSet.rows.item(0) as TItem;
      return await syncLocalItem(localItem, serverItem);
    }));
    return finalData;
  }

  async function syncLocalItem(localItem: TItem, serverItem: TItem) {
    console.log("syncLocalItem", {
      localItem,
      serverItem,
      useLocal: localItem && localItem['_localModified'] && localItem['_localModified'] > serverItem['modified']
    });

    if (localItem && localItem['_localModified'] && localItem['_localModified'] > serverItem['modified']) {
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
      _localDelete: 0,
      ...item,
      _localModifiedDate: Date.now(),
      _localModified: isLocalModified ? 1 : 0
    };
    const params: any[] = columns.map(k => localItem[k])
    params.push(oldId ?? item[pk]);
    return await executeSql(updateQuery, params);
  }

  async function insertLocalData(item: TItem, isLocalModified = true) {
    await createTablePromise;
    console.log("insertLocalData");
    let minId: number = Math.min(0, (await executeSql(selectMinId, [])).rows.item(0)['minId']);

    console.log("insertLocalData", minId);
    const localItem = {
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
      })
    };
    let params = columns.map(k => localItem[k]);
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
        knownFailedItemCount++;
      }
      finally {
        ongoingOperationCount--;
      }
    })();
  }
  async function updateItem(item: TItem) {
    await updateLocalData(item);
    ongoingOperationCount++;
    (async function () {
      try {
        const result = await api.update(item);
        updateLocalData(result, false);
      }
      catch (e) {
        knownFailedItemCount++;
      }
      finally {
        ongoingOperationCount--;
      }
    })();
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
        knownFailedItemCount++;
      }
      finally {
        ongoingOperationCount--;
      }
    })();
  }

  function useData(filter: Partial<TItem>, deps: any[]) {
    const [items, setItems] = useState<TItem[]>([]);
    const [loading, setLoading] = useState(true);
    const serverDataLoading = useRef(true);
    const generation = useRef(0);
    const [errorMessage, setErrorMessage] = useState<string>();
    const loadData = useCallback(async () => {
      serverDataLoading.current = true;
      setErrorMessage(null);
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
          console.log(err);
        });
      }
      fromLocalData();
    }, deps);

    useEffectAsync(loadData, deps);

    return { items, loading, errorMessage, reload: loadData };
  }
}