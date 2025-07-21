// Entry point for the Express server
import dotenv from "dotenv";
import app from "./src/config/app";

dotenv.config();

const PORT = process.env.PORT || 3000;

function startServer() {
    app.listen(PORT, () => {
        // eslint-disable-next-line no-console
        console.log(`Server is running on port ${PORT}`);
    });
}

startServer();
