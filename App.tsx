import 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, Modal, Button } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { NavigationContainer, useIsFocused } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
const Stack = createStackNavigator();

const mockTableData = [
  { id: 1, title: 'test todo 1', description: 'test todo 1 description', completed: false, date: '12/03/2021' },
  { id: 1, title: 'test todo 2', description: 'test todo 2 description', completed: false, date: '03/04/2021' },
  { id: 1, title: 'test todo 3', description: 'test todo 3 description', completed: false, date: '09/12/2017' },
  { id: 1, title: 'test todo 4', description: 'test todo 4 description', completed: false, date: '24/09/2019' }
]


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

// function insertMockTableData(columnsKeys: any, columns: Record<string, string>, tx: any, tableName: string, setLocalQueryPartialQuery: string) {
//   tx.executeSql(`select * from ${tableName}`, [], (transaction, resultSet: any) => {
//     console.log(resultSet)
//     let tableData = [...resultSet.rows];
//     if (tableData.length === 0) {
//       mockTableData.forEach(item => {
//         let mockDataItemArray = [];
//         for (let i = 0; i < columnsKeys.length; i++) {
//           mockDataItemArray.push(item[columnsKeys[i]]);
//         }
//         console.log(columnsKeys[1])
//         tx.executeSql(
//           `insert into ${tableName} (${columnsKeys.join(', ')}) values (${setLocalQueryPartialQuery});`
//           , mockDataItemArray
//           , (transaction, resultSet) => console.log('we made it', resultSet)
//           , (transaction, err): any => console.log(err)
//         );
//       });
//     }
//   }, (trasaction, err): any => console.log(err));
// }

type SqlObj<T> = {} & {
  [P in keyof T]:
  T[P] extends "number" ? number :
  T[P] extends "string" ? string :
  T[P] extends "bit" ? 1 | 0 :
  T[P] extends "date" ? Date :
  unknown
}

function createSqlFunction<C extends Record<string, V>, V extends string>(tableName: string, columns: C) {
  // Move all query string creation here
  // Code to create table!
  const db = SQLite.openDatabase('api');
  const columnsKeys = Object.keys(columns);
  const getLocalPartialQuery = `select * from ${tableName}`;
  let createLocalTablePartialQuery = '';
  let setLocalQueryPartialQuery = '';
  for (let i = 0; i < columnsKeys.length; i++) {
    setLocalQueryPartialQuery = i === columnsKeys.length - 1 ? setLocalQueryPartialQuery + '?' : setLocalQueryPartialQuery + '?, ';
    createLocalTablePartialQuery = i === columnsKeys.length - 1 ? createLocalTablePartialQuery + `${columnsKeys[i]} ${columns[columnsKeys[i]]}` : createLocalTablePartialQuery + `${columnsKeys[i]} ${columns[columnsKeys[i]]}, `
  }
  return {
    getLocal,
    setLocal
  };

  async function getLocal(filter: Partial<SqlObj<C>>) {
    return new Promise<Array<SqlObj<C>>>((resolve, reject) => {
      db.transaction(tx => {
        // tx.executeSql(`create table if not exists ${tableName} (${createLocalTablePartialQuery})`, [], (transaction, resultSet) => insertMockTableData(columnsKeys, columns, tx, tableName, setLocalQueryPartialQuery), (trasaction, err): any => console.log(err))
        const keys = Object.keys(filter);
        // ToDo Move code to create query outside in body of createSqlFunction
        let query = filter[keys[0]] === '' ? getLocalPartialQuery : `${getLocalPartialQuery} where ${keys[0]} like '%${filter[keys[0]]}%'`;
        tx.executeSql(query, [], (transaction, resultSet: any) => {
          console.log(resultSet)
          // var arr = [];
          // for (let key in resultSet) {
          //   arr.push(Object.assign(resultSet[key], { name: key }));
          // }
          resolve([...resultSet.rows]);
        }, (trasaction, err): any => reject(err));
      });
    });
  }
  async function setLocal(data: Array<SqlObj<C>>) {
    return new Promise<void>((resolve, reject) => {
      db.transaction(tx => {
        // TODO: Insert or updated don't delete
        tx.executeSql(`delete from ${tableName}`, [], (transaction, resultSet) => console.log("data deleted"), (trasaction, err): any => console.log(err));
        data.forEach(item => {
          let itemArray = [];
          for (let i = 0; i < columnsKeys.length; i++) {
            itemArray.push(item[columnsKeys[i]]);
          }
          tx.executeSql(
            `insert into ${tableName} (${columnsKeys.join(', ')}) values (${setLocalQueryPartialQuery});`
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


type ITodo = GetSqlObjFromGetLocal<typeof getLocal>
type GetSqlObjFromGetLocal<T> = T extends (a: any) => Promise<Array<infer U>> ? U : never
const { getLocal, setLocal } = createSqlFunction("todos", {
  "id": "number",
  "title": "string",
  "description": "string",
  "completed": "bit",
  "date": "date"
})

function DisplayData(props) {
  return (
    <View style={styles.dataContent}>
      <Text> Title: {props.todo.title}</Text>
      <Text> Description: {props.todo.description}</Text>
      <Text> Date: {props.todo.date}</Text>
    </View>
  )
}

function updateLocalData(item: ITodo, tableName: string) {
  return new Promise<void>((resolve, reject) => {
    const db = SQLite.openDatabase('api');
    const keys = Object.keys(item);
    let partialQuery = '';
    let itemArray = [];
    console.log(keys.length)
    keys.forEach((key, index) => {
      if (index > 0) {
        console.log(index)
        partialQuery = index === keys.length - 1 ? partialQuery + `${keys[index]} = ?` : partialQuery + `${keys[index]} = ?, `
        itemArray.push(item[key]);
      }
    });
    db.transaction(tx => {
      tx.executeSql(`update ${tableName} set ${partialQuery} where id = ${item.id}`, itemArray, (transaction, resultSet) => resolve(), (transaction, err): any => reject());
    })
  });
}

async function updateServerData(item: any, tableName: string) {
  console.log(JSON.stringify(item))
  const response = await fetch(`http://localhost:4000/api/todo/${item.id}`, {
    method: "PUT",
    body: JSON.stringify(item),
    headers: {
      "Content-type": "application/json",
      'Accept': 'application/json'
    }
  });
  console.log(response)
  let data = await response.json();
  return data;
}

function deleteData(id: number) {
  deleteLocalData(id).then(res => console.log('deleted'));
  deleteServerData(id).then(res => console.log(res));
}

function deleteLocalData(id: number) {
  return new Promise<void>((resolve, reject) => {
    const db = SQLite.openDatabase('api');
    db.transaction(tx => {
      tx.executeSql(`delete from todos where id = ?`, [id], (transaction, resultSet) => resolve(), (transaction, err): any => reject());
    })
  })
}

async function deleteServerData(id: number) {
  const response = await fetch(`http://localhost:4000/api/todo/${id}`, { method: 'DELETE' });
  console.log(response)
  let data = await response.json();
  return data;
}

async function createServerData(item, tableName: string) {
  const response = await fetch(`http://localhost:4000/api/todo/`, {
    method: "POST",
    body: JSON.stringify(item),
    headers: {
      "Content-type": "application/json",
      'Accept': 'application/json'
    }
  });
  console.log(response)
  let data = await response.json();
  return data;
}

function Home({ navigation }) {
  const [filterTitle, setFilterTitle] = useState("");
  const { items, loading, errorMessage } = useData({
    loader: () => getTodos({ title: filterTitle }, 'todos'),
    localLoader: () => getLocal({ title: filterTitle }),
    localDataSetter: setLocal,
    deps: [filterTitle]
  });

  return (
    <View style={styles.container}>
      <View style={styles.inputContainer}>
        <TextInput style={styles.inputBox} placeholder="Filter todos by title" onChange={(event: any) => setFilterTitle(event.target.value)} />
        <View style={styles.newDataButton}>
          <Button title="Add new todo" onPress={() => navigation.navigate('AddData', { tableName: 'todos' })} />
        </View>
      </View>
      {items.length > 0 ? items.map((item, index) => {
        return (
          <View key={index + 'f'} style={styles.dataContainer}>
            <DisplayData key={index} todo={item} />
            <Button
              key={index + 'a'}
              title="Go to Details"
              onPress={() => navigation.navigate('EditData', { item: item, tableName: 'todos' })}
            />
            <Button
              key={index + 'b'}
              title="Delete"
              onPress={() => { deleteData(item.id) }} />
          </View>)
      }) : <Text>nothing is working!!!!</Text>}
    </View>
  );
}

function AddData({ navigation, route }) {
  let [item, setItem] = useState({ title: '', description: '', date: '', completed: false });
  const createNewData = () => {
    //createLocalData(item, tableName).then(() => { console.log("Updated local data") });
    createServerData(item, route.params.tableName).then(res => console.log("Created server data ", res));
  }
  return (
    <View style={styles.container}>
      <Text style={{ fontSize: 35, marginBottom: 50 }}>Edit your data</Text>
      <TextInput style={styles.inputBox}
        value={item.title}
        onChangeText={(event: any) => setItem({ ...item, title: event })}
        placeholder='Title'></TextInput>
      <TextInput style={styles.inputBox}
        value={item.description}
        onChangeText={(event: any) => setItem({ ...item, description: event })}
        placeholder='Description'></TextInput>
      <TextInput style={styles.inputBox}
        value={item.date}
        onChangeText={(event: any) => setItem({ ...item, date: event })}
        placeholder='Date'></TextInput>
      <Button
        title="Save changes"
        onPress={() => createNewData()}
      />
    </View>
  )
}

function EditData({ navigation, route }) {
  let [item, setItem] = useState<ITodo>(route.params.item);
  const tableName = route.params.tableName;
  const updateData = () => {
    updateLocalData(item, tableName).then(() => { console.log("Updated local data") });
    updateServerData(item, tableName).then(res => console.log("Updated server data ", res));
  }

  return (
    <View style={styles.container}>
      <Text style={{ fontSize: 35, marginBottom: 50 }}>Edit your data</Text>
      <TextInput style={styles.inputBox}
        value={item.title}
        onChangeText={(event: any) => setItem({ ...item, title: event })}></TextInput>
      <TextInput style={styles.inputBox}
        value={item.description}
        onChangeText={(event: any) => setItem({ ...item, description: event })} ></TextInput>
      <Button
        title="Save changes"
        onPress={() => updateData()}
      />
    </View>
  )
}


function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen
          name="Home"
          component={Home}
          options={{ title: 'Home' }}
        />
        <Stack.Screen
          name="EditData"
          component={EditData}
          options={{ title: 'Edit Data' }}
        />
        <Stack.Screen name="AddData" component={AddData} options={{ title: 'Add Data' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    marginTop: 200
  },
  inputContainer: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    marginBottom: 25
  },
  inputBox: {
    marginBottom: 25,
    height: 25,
    width: '100%',
    borderColor: 'red',
    borderWidth: 1
  },
  newDataButton: {
    width: '100%'
  },
  dataContainer: {
    borderWidth: 1,
    borderColor: 'blue',
    borderRadius: 25,
    width: "100%",
    height: 35,
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-around'
  },
  dataContent: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-around'
  }
});

export default App;
