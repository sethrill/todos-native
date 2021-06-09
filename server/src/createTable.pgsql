drop table if exists todos;
create table todos(
    "id"              SERIAL PRIMARY KEY,
    "title"           VARCHAR(100),
    "description"           VARCHAR(100),
    "date" date,
    "modifiedDate" bigint,
    "isDeleted" boolean DEFAULT FALSE
)