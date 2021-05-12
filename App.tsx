import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import * as SQLite from 'expo-sqlite';


function delay(ms: number): Promise<number> {
  return new Promise<number>((resolve, reject) =>
    setTimeout(() => {
      resolve(10)
    }, ms)
  );
}

// function sum(a: number, b: number){
//   return a + b;
// }
// function createSumBy(a: number) {
//   return {
//     x: (b: number) => sum(a, b),
//     y: (b: number) => sum(a * 2, b * 2),
//   }
// }


// let { x, y } = createSumBy(10);
// let s = s10.x(1);
// let s1 = s10.y(2)
// let { x: xx, y: yy} = createSumBy(100);


function filterData(data: ITodo[], filter: { title?: string }) {
  return data.filter(item => item.title.includes(filter.title))
}

async function getTodos(filter: { title?: string }, tableName: string) {
  const response = await fetch('http://localhost:4000/api/todo?tableName=' + tableName);
  let data = await response.json() as ITodo[];
  if (filter.title !== '') {
    return filterData(data, filter);
  }
  return data;
}


function useEffectAsync(fn: () => Promise<void>, deps: any[]) {
  useEffect(() => {
    fn();
  }, deps);
}

function useData<T>({ loader, localLoader, localDataSetter, deps }: {
  loader: () => Promise<T[]>,
  localLoader: () => Promise<T[]>
  localDataSetter: (data: T[]) => Promise<void>,
  deps: any[]
}) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [serverDataLoading, setServerDataLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string>();
  useEffectAsync(async () => {
    setServerDataLoading(true);
    try {
      loader().then((res) => {
        localDataSetter(res);
        setItems(res);
        setServerDataLoading(false);
      }, err => console.log(err));
      localLoader().then((res) => {
        if (serverDataLoading) {
          setItems(res);
        }
      }, err => console.log(err));
      setLoading(false);
    } catch (e) {
      setErrorMessage("Error!");
    }
  }, deps);
  return { items, loading, errorMessage };
}




function createSqlFunction(tableName: string, columns: Record<string, string>) {
  return {
    getLocal: async function getLocalTodos(filter: Record<string, string>) {
      return new Promise<any[]>((resolve, reject) => {
        const db = SQLite.openDatabase('api');
        db.transaction(tx => {
          const keys = Object.keys(filter);
          let query = filter[keys[0]] === '' ? `select * from ${tableName}` : `select * from ${tableName} where ${keys[0]} like '%${filter[keys[0]]}%'`;
          tx.executeSql(query, [], (transaction, resultSet: any) => {
            resolve([...resultSet.rows]);
          }, (trasaction, err): any => reject(err));
        });
      });
    }, setLocal: async function setLocalTodos(data: ITodo[]) {
      return new Promise<void>((resolve, reject) => {
        const db = SQLite.openDatabase('api');
        db.transaction(tx => {
          tx.executeSql(`delete from ${tableName}`, [], (transaction, resultSet) => console.log("data deleted"), (trasaction, err): any => console.log(err));
          let keys = Object.keys(columns);
          data.forEach(item => {
            let itemArray = [];
            let partialQuery = '';
            for (let i = 0; i < keys.length; i++) {
              itemArray.push(item[keys[i]]);
              partialQuery = i === keys.length - 1 ? partialQuery + '?' : partialQuery + '?, ';
            }
            tx.executeSql(
              `insert into ${tableName} (${keys.join(', ')}) values (${partialQuery});`
              , itemArray
              , (transaction, resultSet) => console.log('we made it', resultSet)
              , (transaction, err): any => console.log(err)
            );
          });
          tx.executeSql(`select * from todos`, [], (transaction, resultSet) => console.log(resultSet.rows), (trasaction, err): any => console.log(err));
        }, reject, () => resolve(null));
      });
    }
  }
}

const { getLocal, setLocal } = createSqlFunction("todos", {
  "id": "number",
  "title": "string",
  "description": "string",
  "completed": "bit",
  "date": "date"
})

function App() {
  const [filterTitle, setFilterTitle] = useState("");
  const { items, loading, errorMessage } = useData({
    loader: () => getTodos({ title: filterTitle }, 'todos'),
    localLoader: () => getLocal({ title: filterTitle }),
    localDataSetter: setLocal,
    deps: [filterTitle]
  });
  return (
    <View style={styles.container}>
      <TextInput style={styles.inputBox} placeholder="Filter todos by title" onChange={(event: any) => setFilterTitle(event.target.value)} />
      {items.length > 0 ? items.map((item, index) => {
        return (<Text key={index}>{item.title}</Text>)
      }) : <Text>nothing is working!!!!</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputBox: {
    marginBottom: 25,
    height: 25,
    width: 400,
    borderColor: 'red',
    borderWidth: 1
  }
});

interface ITodo {
  completed: string;
  date: string;
  description: string;
  id: number;
  title: string;
}

export default App;
