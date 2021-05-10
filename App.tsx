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

// async function twoP() {
//   let net = delay(1000);
//   let db = delay(2000);
//   db.then(r => { if(!state) setState() });
//   net.then(r => { setState(), saveToDb() });
// }

async function getLocalToDos(filter: { title?: string }) {
  return new Promise<any[]>((resolve, reject) => {
    const db = SQLite.openDatabase('api');
    db.transaction(tx => {
      tx.executeSql(`select * from todos`, [], (transaction, resultSet: any) => {
        if (filter.title !== '') {
          let result: ITodo[] = [...resultSet.rows];
          result = result.filter(todo => todo.title.includes(filter.title));
          resolve(result);
        }
        resolve([...resultSet.rows]);
      }, (trasaction, err): any => reject(err));
    });
  });
}


async function getTodos(filter: { title?: string }) {
  const response = await fetch('http://localhost:4000/api/todo');
  let data = await response.json() as ITodo[];
  if (filter.title !== '') {
    const result: ITodo[] = data.filter(todo => todo.title.includes(filter.title));
    return result;
  }
  return data;
}


function useEffectAsync(fn: () => Promise<void>, deps: any[]) {
  useEffect(() => {
    fn();
  }, deps);
}

async function setLocalTodos(data: ITodo[]) {
  return new Promise<void>((resolve, reject) => {
    const db = SQLite.openDatabase('api');
    db.transaction(tx => {
      tx.executeSql(`delete from todos`, [], (transaction, resultSet) => console.log("data deleted"), (trasaction, err): any => console.log(err));
      data.forEach(item => {
        tx.executeSql(
          `insert into todos (id, title, description, completed, date) values (?, ?, ?, ?, ?);`
          , [item.id, item.title, item.description, item.completed, item.date]
          , (transaction, resultSet) => console.log('we made it', resultSet)
          , (transaction, err): any => console.log(err)
        );
      });
      tx.executeSql(`select * from todos`, [], (transaction, resultSet) => console.log(resultSet.rows), (trasaction, err): any => console.log(err));
    }, reject, () => resolve(null));
  });
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

function App() {
  const [filterTitle, setFilterTitle] = useState("");
  const { items, loading, errorMessage } = useData({
    loader: () => getTodos({ title: filterTitle }),
    localLoader: () => getLocalToDos({ title: filterTitle }),
    localDataSetter: setLocalTodos,
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
