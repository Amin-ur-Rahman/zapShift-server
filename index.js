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
    const paymentColl = zapShift.collection("payment_collection");

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
          parcelName: paymentInfo.parcelName,
        },
        customer_email: paymentInfo.senderEmail,
        mode: "payment",
        success_url: `${process.env.CLIENT_SIDE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_SIDE_DOMAIN}/dashboard/payment-cancelled`,
      });

      res.send({ url: session.url });
      console.log(session.url);
    });

    app.patch("/on-payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      console.log(sessionId);

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // res.send(session);
      console.log(session);

      if (session.payment_status === "paid") {
        function generateTrackingId() {
          const prefix = "PRCL";

          const date = new Date();
          const y = date.getFullYear();
          const m = String(date.getMonth() + 1).padStart(2, "0");
          const d = String(date.getDate()).padStart(2, "0");

          const random = Math.random()
            .toString(36)
            .substring(2, 8)
            .toUpperCase();

          return `${prefix}-${y}${m}${d}-${random}`;
        }
        const trackingId = generateTrackingId();

        const id = session.metadata.productId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: "paid",
            trackingId: trackingId,
          },
        };

        const result = await parcelsColl.updateOne(query, update);
        console.log(result);
        // res.send({ updateInfo: result, paymentinfo: session });

        const paymentData = {
          amount: parseFloat(session.cost) / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.productId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
        };

        const insertPaymentResponse = await paymentColl.insertOne(paymentData);
        res.send({
          success: true,
          parcelModify: result,
          paymentResponse: insertPaymentResponse,
          trackingId: trackingId,
          transactionId: session.payment_intent,
        });
      }
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
