const express = require("express");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const stripe = require("stripe")(`${process.env.STRIPE_SECRET}`);

// mongo db setup-----------
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ix21m2z.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const cors = require("cors");
const port = process.env.PORT || 3000;

// middlewares---------------

app.use(cors());
app.use(express.json());

// ------------APIs-----------

app.get("/", (req, res) => {
  res.send("zap shift server connected!");
});

const run = async () => {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );

    const zapShift = client.db("zapShift_DB");
    const parcelsColl = zapShift.collection("parcels_collection");

    app.post("/parcels", async (req, res) => {
      const query = req.body;
      try {
        const result = await parcelsColl.insertOne(query);
        if (!result.acknowledged) {
          throw new Error("request failed");
        }
        res.send(result);
      } catch (error) {
        console.log(error);
        res.send(error);
      }
    });

    app.get("/parcels", async (req, res) => {
      try {
        const email = req.query.email;
        const query = email ? { senderEmail: email } : {};
        const cursor = parcelsColl.find(query);
        const result = await cursor.toArray();
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send(error);
      }
    });

    // ------stripe api----------

    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost * 100);
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              product_data: {
                name: paymentInfo.parcelName,
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        metadata: {
          productId: paymentInfo._id,
        },
        customer_email: paymentInfo.senderEmail,
        mode: "payment",
        success_url: `${process.env.CLIENT_SIDE_DOMAIN}/dashboard/payment-success`,
        cancel_url: `${process.env.CLIENT_SIDE_DOMAIN}/dashboard/payment-cancelled`,
      });

      res.send({ url: session.url });
      console.log(session.url);
    });

    // -----------------------------------------------
    app.delete("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        // if (!id) return;
        const query = { _id: new ObjectId(id) };

        const response = await parcelsColl.deleteOne(query);
        if (response.deletedCount <= 0) {
          return res.status(404).send({ acknowledged: true, deletedCount: 0 });
        }
        res.send(response);
      } catch (error) {
        console.error(error);
        res.send(error);
      }
    });
  } catch (error) {
    console.log(error);
  }
};
run().catch(console.dir);

app.listen(port, () => {
  console.log("server is running at port:", port);
});
