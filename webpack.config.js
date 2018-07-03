const path = require('path');
const CleanWebpackPlugin = require('clean-webpack-plugin');

module.exports = {
    mode: 'development',
    devtool: 'inline-source-map', 

    entry: {
        app: ["./src/index.ts"]
    },

    output: {
        libraryTarget: "umd",
        library: "onix",
        path: path.join(__dirname, "public/js"),
        filename: "app.[name].js"
    },

    plugins: [
        new CleanWebpackPlugin(['public/js'])
    ],

    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/
            }
        ]
    },

    resolve: {
        extensions: ['.tsx', '.ts', '.js']
    }
};