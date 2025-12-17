const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_KEY);
const crypto = require('crypto');

const port = process.env.PORT || 3000;
const app = express();
app.use(cors());
app.use(express.json());


const admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


const verifyFBToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).send({ message: 'unauthorized access' });
    }

    try {
        const idToken = authHeader.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        // console.log("decoded info:", decoded);

        req.decoded_email = decoded.email;
        next();
    } catch (error) {
        return res.status(401).send({ message: 'unauthorized access' });
    }
};



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
        const paymentsCollection = database.collection('payments')

        //save user info
        app.post('/users', async (req, res) => {
            const userInfo = req.body;
            userInfo.role = "donor";
            userInfo.createdAt = new Date();
            userInfo.status = 'active';
            const result = await userCollections.insertOne(userInfo);
            res.send(result)
        })

        //get all users
        app.get('/users', verifyFBToken, async (req, res) => {
            const result = await userCollections.find().toArray();
            res.status(200).send(result)
        })


        //get user role and status
        app.get('/users/role/:email', async (req, res) => {
            const { email } = req.params
            const query = { email: email }
            const result = await userCollections.findOne(query)
            // console.log(result);
            res.send(result)
        })

        //update status
        app.patch('/update/user/status', verifyFBToken, async (req, res) => {
            const { email, status } = req.query;
            const query = { email: email };

            const updataStatus = {
                $set: {
                    status: status
                }
            }
            const result = await userCollections.updateOne(query, updataStatus)
            res.send(result)
        })

        //make volunteer
        app.patch('/update/user/role', verifyFBToken, async (req, res) => {
            const { email, role } = req.query;
            const query = { email: email };

            const updataRole = {
                $set: {
                    role: role
                }
            }
            const result = await userCollections.updateOne(query, updataRole)
            res.send(result)
        })

        //make admin
        app.patch('/update/user/admin', verifyFBToken, async (req, res) => {
            const { email, role } = req.query;
            const query = { email: email };

            const updataAdmin = {
                $set: {
                    role: role
                }
            }
            const result = await userCollections.updateOne(query, updataAdmin)
            res.send(result)
        })


        //create request
        app.post('/requests', verifyFBToken, async (req, res) => {
            const data = req.body;
            data.createdAt = new Date();
            const result = await requestCollections.insertOne(data)
            res.send(result)
        })

        //get request of user
        app.get('/my-request', verifyFBToken, async (req, res) => {
            const email = req.decoded_email;
            const size = Number(req.query.size)
            const page = Number(req.query.page)
            const query = { requester_email: email };

            const result = await requestCollections
                .find(query)
                .limit(size)
                .skip(size * page)
                .toArray();

            const totalRequest = await requestCollections.countDocuments(query);
            res.send({ request: result, totalRequest })
        })

        //search donor
        app.get('/search-requests', async (req, res) => {
            const { bloodGroup, district, upazila } = req.query;
            const query = { role: 'donor' };


            if (bloodGroup) {
                const fixed = bloodGroup.replace(/ /g, "+").trim();
                query.blood = fixed;
            }

            if (district) {
                query.district = district
            }
            if (upazila) {
                query.upazila = upazila
            }
            const result = await userCollections.find(query).toArray();
            res.send(result)
        })

        //get all pending requests
        app.get('/pending-requests', async (req, res) => {
            const query = { donation_status: "pending" }
            const result = await requestCollections.find(query).toArray()
            res.send(result)
        })

        //get request details
        app.get('/details/:id', async (req, res) => {
            const id = req.params
            const query = { _id: new ObjectId(id) }
            const result = await requestCollections.findOne(query)
            res.send(result);
        })

        //donate blood /confirm donation
        app.patch('/donate-blood/:id', verifyFBToken, async (req, res) => {
            const id = req.params;
            const { donor_name, donor_email } = req.body;

            const filter = { _id: new ObjectId(id) };

            const updateDoc = {
                $set: {
                    donor_name: donor_name,
                    donor_email: donor_email,
                    donation_status: 'inprogress',
                }
            };

            const result = await requestCollections.updateOne(filter, updateDoc);
            res.send(result);
        });


        //payment
        app.post('/create-payment-checkout', async (req, res) => {
            const information = req.body;
            const amount = parseInt(information.donateAmount) * 100;
            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            unit_amount: amount,
                            product_data: {
                                name: 'Donation Amount:'
                            }
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                metadata: {
                    donorName: information?.donorName
                },
                customer_email: information.donorEmail,
                success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/payment-cancelled`,
            });
            res.send({ url: session.url })
        })

        //payment info save to DB
        app.post('/success-payment', async (req, res) => {
            const { session_id } = req.query;
            const session = await stripe.checkout.sessions.retrieve(
                session_id
            );
            // console.log(session);
            const transactionId = session.payment_intent;

            const isPaymentExist = await paymentsCollection.findOne({ transactionId })
            if (isPaymentExist) {
                return res.status(400).send('Already Exist')
            }

            if (session.payment_status == 'paid') {
                const paymentInfo = {
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    donorEmail: session.customer_email,
                    transactionId,
                    payment_status: session.payment_status,
                    paidAt: new Date()
                }
                const result = await paymentsCollection.insertOne(paymentInfo)
                return res.send(result)
            }

        })

        //get all payments
        app.get('/all-funds', verifyFBToken, async (req, res) => {
            const result = await paymentsCollection.find().toArray();
            res.status(200).send(result)
        })



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