import { Client, Account, Databases } from "appwrite";

const client = new Client()
    .setEndpoint("https://sgp.cloud.appwrite.io/v1")
    .setProject("695fd6e100031990834d");

const account = new Account(client);
const databases = new Databases(client);

export { client, account, databases };
