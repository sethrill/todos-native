import * as express from 'express';
const app = express();
import * as bodyParser from 'body-parser';
import { routes as toDoRoutes } from './routes/todosRouter';

const port = process.env.PORT || 3000;


app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // update to match the domain you will make the request from
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Credentials", "true")
  res.header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE");
  next();
})
app.use('/api', toDoRoutes());
app.get('/', (req, res) => {
  res.send('welcome dfd');
});

app.listen(port, () => {
  console.log("run", port);
});
