import 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, Modal, Button } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { NavigationContainer, useIsFocused } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
const Stack = createStackNavigator();

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
      // T: What loading ends here ? both local and server have not finised as they are in the promise 
      setLoading(false);
    } catch (e) {
      setErrorMessage("Error!");
    }
  }, deps);
  return { items, loading, errorMessage };
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
        // T: Whi is this commented out ?
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
        // T: Still to do here 😋
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

// T: we need some extra info here, about the last modified date, and if there are local changes that need to go to the server
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
        partialQuery = partialQuery + `${keys[index]} = ?, `
        itemArray.push(item[key]);
      }
    });
    //the columns don't exist yet in the table;
    //the modified column will be by default false but it will become true if changes are made and will be changed back to false once the changes are made on the server
    partialQuery = partialQuery + 'modified = ?, ';
    partialQuery = partialQuery + 'modifiedDate = ?';
    itemArray.push(true);
    itemArray.push('modified date placeholder');
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

// T: I this this should be a generic function we can create from the local change function and the server change function 
// Simialr for update, insert below
// The algo should be:
// 1: Mark the row as locally deleted (but do not actually delete)
// 2: Send delete to server
// 3: If the reqest succeded delete the row from the database
// 4: If the request failed, leave the row marked as deleted (we should have a global loop to send updates)
// Note, the promise the function returns should complete after the local data is updated, 
// so we don't keep the user wating
function deleteData(id: number, tableName: string) {
  deleteLocalData(id, tableName).then(res => deleteServerData(id).then(res => {
    console.log(res);
    const db = SQLite.openDatabase('api');
    db.transaction(tx => {
      tx.executeSql(`delete from ${tableName} where id = ?`, [res.row[0].id], (transaction, resultSet) => console.log('done'), (transaction, err): any => console.log(err));
    })
  }));
}
// T: There need to be a way to track if a row is deleted locally but the request failed to get to the server
function deleteLocalData(id: number, tableName: string) {
  return new Promise<void>((resolve, reject) => {
    const db = SQLite.openDatabase('api');
    //toBeDeleted will be a new column in the local db
    //need to decide on the name for this column
    db.transaction(tx => {
      tx.executeSql(`update ${tableName} set toBeDeleted = ? where id = ?`, [true, id], (transaction, resultSet) => resolve(), (transaction, err): any => reject());
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

function createLocalData(item, tableName: string) {
  return new Promise<void>((resolve, reject) => {
    const db = SQLite.openDatabase('api');
    const keys = Object.keys(item);
    keys.unshift('id');
    keys.push('modified');
    keys.push('modifiedDate')
    let partialQuery = '';
    let itemArray = [];
    console.log(keys.length)
    keys.forEach((key, index) => {
      if (key === 'id') {
        itemArray.push(-1);
      } else if (key === 'modified') {
        itemArray.push(false)
      } else if (key === 'modifiedDate') {
        itemArray.push('current date!!');
      } else {
        itemArray.push(item[key]);
      }
      partialQuery = index === keys.length - 1 ? partialQuery + '?' : partialQuery + '?, ';
    });
    console.log(partialQuery, itemArray, keys)
    db.transaction(tx => {
      tx.executeSql(`insert into ${tableName} (${keys.join(', ')}) values (${partialQuery})`, itemArray, (transaction, resultSet) => resolve(), (transaction, err): any => reject());
    })
  });
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
          <Button title="Add new todo" onPress={() => navigation.navigate('AddData', { item: { title: '', description: '', date: '', completed: false }, tableName: 'todos' })} />
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
              onPress={() => { deleteData(item.id, 'todos') }} />
          </View>)
      }) : <Text>nothing is working!!!!</Text>}
    </View>
  );
}

function AddData({ navigation, route }) {
  let [item, setItem] = useState(route.params.item);
  const keys = Object.keys(item);
  // T: I this this should be a generic function we can create from the local change function and the server change function 
  // The algo should be:
  // 1: Create the  row locally, with a temporary id (something negative should work)
  // 2: Send insert to server
  // 3: If the reqest succeded change the id to the new id returned by the server
  // 4: If the request failed, leave the row with the temp id (we should have a global loop to send updates)
  // Note, the promise the function returns should complete after the local data is updated, 
  // so we don't keep the user wating
  const createNewData = () => {
    createLocalData(item, route.params.tableName).then(() => {
      console.log("Updated local data");
      createServerData(item, route.params.tableName).then(res => {
        console.log("Created server data ", res)
        const db = SQLite.openDatabase('api');
        db.transaction(tx => {
          //MAYBE: modified and modifiedDate will be presend on every table that exists in the local db
          tx.executeSql(`update ${route.params.tableName} set id = ? where id = ${-1}`, [res.row[0].id], (transaction, resultSet) => console.log('updated'), (transaction, err): any => console.log(err))
        });
      });
    });
  }
  return (
    <View style={styles.container}>
      <Text style={{ fontSize: 35, marginBottom: 50 }}>Add data</Text>
      {keys.map((keyItem, index) => {
        if (keyItem !== 'id' && keyItem !== 'completed') {
          return (<TextInput key={index} style={styles.inputBox} value={item[keyItem]} onChangeText={(event: any) => setItem({ ...item, [keyItem]: event })} placeholder={keyItem} />)
        }
      })}
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
  const keys = Object.keys(item);
  console.log(keys);
  // T: I this this should be a generic function we can create from the local change function and the server change function 
  // The algo should be:
  // 1: Update local data, and mark the row as locally changed
  // 2: Send data so server
  // 3: If the reqest succeded mark the row as having no local changes
  // 4: If the request failed, leave the modified row in the database
  // Note, the promise the function returns should complete after the local data is updated, 
  // so we don't keep the user wating
  const updateData = () => {
    console.log(item)
    updateLocalData(item, tableName).then(() => {
      console.log("Updated local data");
      //MAYBE: send the user back to the home page while the server data update is done in the background (?)
      updateServerData(item, tableName).then(res => {
        console.log("Updated server data ", res);
        const db = SQLite.openDatabase('api');
        db.transaction(tx => {
          //MAYBE: modified and modifiedDate will be presend on every table that exists in the local db
          tx.executeSql(`update ${tableName} set modified = ? where id = ${item.id}`, [false], (transaction, resultSet) => console.log('updated'), (transaction, err): any => console.log(err))
        });
      });
    });
  }

  return (
    <View style={styles.container}>
      <Text style={{ fontSize: 35, marginBottom: 50 }}>Edit your data</Text>
      {keys.map((key, index) => {
        if (key !== 'id') {
          return (<TextInput key={index} style={styles.inputBox} value={item[key]} onChangeText={(event: any) => setItem({ ...item, [key]: event })} />)
        }
      })}
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
