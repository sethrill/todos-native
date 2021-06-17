import * as express from 'express';
import { Pool } from 'pg';

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'todo',
  password: 'postgres',
  port: 5432,
})

export function routes() {
  const router = express.Router();
  router.route('/todo/:id')
    .delete((req, res) => {
      const id = parseInt(req.params.id);
      pool.query(`UPDATE todos SET 
        "isDeleted" = TRUE
        WHERE id = $1
        RETURNING "id", "title", "description","date", "modifiedDate"`,
        [id], (error, results) => {
          if (error) {
            throw error;
          }
          res.status(200).json(results.rows[0]);
        })

      // pool.query('DELETE FROM todos WHERE id = $1 RETURNING *', [id], (error, results) => {
      //   if (error) {
      //     throw error;
      //   }
      //   res.status(200).json(results.rows[0]);
      // })
    })
    .put((req, res) => {
      const id = parseInt(req.params.id);
      const { title, description, date } = req.body;
      console.log(id)
      pool.query(`UPDATE todos SET 
        title = $1, description = $2, date = $3, "modifiedDate" = $4
        WHERE id = $5
        RETURNING "id", "title", "description","date", "modifiedDate"`,
        [title, description, date, Date.now(), id], (error, results) => {
          if (error) {
            throw error;
          }
          res.status(200).json(results.rows[0]);
        })
    })
    .get((req, res) => {
      const id = parseInt(req.params.id)
      pool.query(`SELECT "id", "title", "description","date", "modifiedDate" FROM todos WHERE id = $1`, [id], (error, results) => {
        if (error) {
          throw error
        }
        res.status(200).json(results.rows)
      })
    });

  router.route('/todo')
    .post((req, res) => {
      const { title, description, date, localId } = req.body;
      pool.query(`SELECT "id", "title", "description","date", "modifiedDate" FROM todos WHERE localId = $1`, [localId], (error, results) => {
        if (error) {
          throw error
        }
        if (results.rows) {
          res.status(200).json(results.rows)
        } else {
          pool.query('INSERT INTO todos (title, description, date, "modifiedDate", "localId") VALUES ($1, $2, $3, $4) RETURNING "id", "title", "description","date", "modifiedDate"',
            [title, description, date, Date.now(), localId], (error, results) => {
              if (error) {
                throw error;
              }
              res.status(201).json(results.rows[0])
            })
        }
      })
    })
    .get((req, res) => {
      let { title, lastSeenDeletion } = req.query;
      let [query, params] = [
        `SELECT "id", "title", "description","date", "modifiedDate" FROM todos`,
        [] as any[]
      ]
      if (title) {
        [query, params] = [
          query + ` WHERE (title like $1) and ("isDeleted" = FALSE)`,
          ['%' + title + '%']
        ]
      }
      else if (lastSeenDeletion) {
        [query, params] = [
          query + ` WHERE ("modifiedDate" > $1) and ("isDeleted" = TRUE)`,
          [lastSeenDeletion]
        ]
      } else {
        [query, params] = [
          query + ` WHERE "isDeleted" = FALSE`,
          []
        ]
      }
      pool.query(query, params, (error, results) => {
        if (error) {
          console.log(query, req.query)
          throw error
        }
        setTimeout(() => {
          res.status(200).json(results.rows)
        }, lastSeenDeletion ? 0 : 10000);
      })
    });
  return router;
}