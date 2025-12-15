const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
require('dotenv').config();

const port = process.env.PORT || 3000;
const app = express();
app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@first-cluster.xds9q0g.mongodb.net/?appName=first-cluster`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        await client.connect();

        const database = client.db('BloodBridgeDB')
        const userCollections = database.collection('user')

        const requestCollections = database.collection('request')

        //save user info
        app.post('/users', async (req, res) => {
            const userInfo = req.body;
            userInfo.role = "donor";
            userInfo.createdAt = new Date();
            userInfo.status = 'active';
            const result = await userCollections.insertOne(userInfo);
            res.send(result)
        })

        //get user info/role
        app.get('/users/role/:email', async (req, res) => {
            const { email } = req.params
            const query = { email: email }
            const result = await userCollections.findOne(query)
            // console.log(result);
            res.send(result)
        })


        //create request
        app.post('/requests', async (req, res) => {
            const data = req.body;
            data.createdAt = new Date();
            const result = await requestCollections.insertOne(data)
            res.send(result)
        })
        // app.get('/manager/products/:email', async (req, res) => {
        //     const email = req.params.email;
        //     const query = { managerEmail: email };
        //     const result = await productCollections.find(query).toArray();
        //     res.send(result)
        // })



        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Hello, World!')
})
app.listen(port, () => {
    console.log(`server is running on ${port}`);
})