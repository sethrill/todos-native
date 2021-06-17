import 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, Modal, Button } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { NavigationContainer, useIsFocused } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createSyncFunctions } from './DataSyncHooks';
const Stack = createStackNavigator();

function filterData(data: ITodo[], filter: { title?: string }) {
  return data.filter(item => item.title.includes(filter.title))
}

async function getTodos(filter: Partial<ITodo> & { lastSeenDeletion?: number }) {
  const url = new URL('api/todo', 'http://localhost:4000');
  if(filter.title) {
    url.searchParams.append("title", filter.title);
  }
  if(filter.lastSeenDeletion) {
    url.searchParams.append("lastSeenDeletion", filter.lastSeenDeletion.toString());
  }
  const response = await fetch(url.toString());
  let data = await response.json() as ITodo[];
  if (filter.title != null && filter.title !== '') {
    return filterData(data, filter);
  }
  return data;
}
async function getTodoById(id: number) {
  const response = await fetch('http://localhost:4000/api/todo/' + id);
  let data = await response.json() as ITodo;
  return data;
}


type ITodo = {
  "id": number,
  "title": string,
  "description": string,
  "completed": 1 | 0,
  "date": Date,
  modifiedDate: number
}

const todoApi =  createSyncFunctions("todos", {
  "id": "integer",
  "modifiedDate": "unsigned big int",
  "title": "string?",
  "description": "string",
  "completed": "bit?",
  "date": "date"
}, "id", {
  get: getTodos,
  getById: getTodoById,
  insert: createServerData,
  update: updateServerData,
  delete: o => deleteServerData(o.id),
  getDeletions: (lastSeenDeletion) => getTodos({lastSeenDeletion})
})

function DisplayData(props) {
  return (
    <View style={styles.dataContent}>
      <Text> Id: {props.todo.id}</Text>
      <Text> Title: {props.todo.title}</Text>
      <Text> Description: {props.todo.description}</Text>
      <Text> Date: {props.todo.date}</Text>
    </View>
  )
}

async function updateServerData(item: ITodo) {
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
  return data as ITodo;
}

async function deleteServerData(id: number) {
  const response = await fetch(`http://localhost:4000/api/todo/${id}`, { method: 'DELETE' });
  console.log(response)
  let data = await response.json();
  return data;
}

async function createServerData(item: ITodo) {
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
  return data as ITodo;
}


function Home({ navigation }) {
  const [filterTitle, setFilterTitle] = useState("");
  const { items, loading, errorMessage, reload } = todoApi.useData({
    filter: { title: filterTitle}
  }, [filterTitle]);
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
              onPress={async() => { 
                await todoApi.deleteItem(item) 
                await reload();
              }} />
          </View>)
      }) : <Text>nothing is working!!!! {JSON.stringify(errorMessage)} </Text>}
    </View>
  );
}

function AddData({ navigation, route }) {
  let [item, setItem] = useState(route.params.item);
  const createNewData = () => {
    todoApi.insertItem(item);
  }
  return (
    <View style={styles.container}>
      <Text style={{ fontSize: 35, marginBottom: 50 }}>Add data</Text>
      {Object.keys(item).map((keyItem, index) => {
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
  const updateData = () => {
    console.log(item)
    todoApi.updateItem(item);
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
  useEffect(() => {
    todoApi.doSync();
  })
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
