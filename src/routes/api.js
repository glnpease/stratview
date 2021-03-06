// dependencies
const express = require('express');

// models
const Feature = require('../models/feature');
const Grain = require('../models/grain');
const Bed = require('../models/bed');
const Column = require('../models/column');
const SIndex = require('../search/index');
const ChemType = require('../models/chem_type');
const ChemData = require('../models/chem');

// search 
const {computeIndex} = require('../search/compute_index');

const router = express.Router();

// api endpoints

// on search query : 
// - Get index for each feature in search 
// - Combine frequencies for each column_id 
// - Sort based on combined frequencies 
// - Return list of {column_id: , feature1: feature2: ...}
router.get('/search', function(req, res) {
    const featuresStr = req.query.search_features;
    const features = featuresStr.split(',');

    SIndex.find({ feature_id: { $in : features }  }, function(err, indices){
        if (err) console.log(err);
        
        var values = new Map(); // map from column name -> measure of match quality
        for (i=0; i< indices.length; i++){
            const index = indices[i].frequency; 
            index.forEach(function(value, key, map){
                quality = values.has(key) ? values.get(key) + value : value
                values.set(key, quality); 
            });            
        }

        var result = Array.from(values.keys());
        result.sort(function (a, b) {
            return values.get(b) - values.get(a);
        })
        
        res.send(result); 
    });
});

router.get('/column', function(req, res) {
    Column.find({column_id: req.query.column_id}, function(err, col) {
        res.send(col);
    });
});

router.get('/columns', function(req, res) {
    Column.find({}, function(err, cols) {
        res.send(cols);
    });
});

router.get('/columns_by_ids', function(req, res){
    const idsStr = req.query.column_ids; 
    const ids = idsStr.split(','); 
    Column.find({column_id: {$in: ids}}, function(err, cols){
        res.send(cols); 
    })
});

router.get('/beds', function(req, res) {
    Bed.find({ column_id: req.query.column_id}, function(err, beds) {
        res.send(beds);
    });
});

router.get('/chem', function(req, res) {
    ChemData.find({column_id: req.query.column_id}, function(err, chem) {
        res.send(chem); // Always returns an array, even if size 0 or 1 
    })
});

router.get('/feature', function(req,res){
    // return all features 
    Feature.find({}, function (err, features){
        res.send(features);
    }); 
});

router.get('/chemtype', function(req,res){
    // return all features 
    ChemType.find({}, function (err, chem){
        res.send(chem);
    }); 
});

router.get('/grain', function(req,res){
    // return all grains 
    Grain.find({}, function (err, grains){
        res.send(grains);
    }); 
});

router.post('/column', function(req, res) { 
    // req.body because this is a post request
    // If we are editing, the column already exists. delete its beds. 
    // TODO: an improvement would be to not rewrite all beds, but that's difficult. 
    if (req.body.edited){
        const col = req.body.column_id;
        console.log("Column is edited, deleting all old beds before saving new"); 
        Bed.deleteMany({column_id:col}, function(err){
            if (err) {(console.log(err))}
            Column.deleteMany({column_id:col}, function(err){
                if(err) {console.log(err)}
                ChemData.deleteMany({column_id:col}, function(err){
                    if(err) {console.log(err)};
                    console.log("Deleted all beds for column "+col); 
                    save_column(req,res);
                })
            })
        })
    }else {
        save_column(req,res);
    }
});

// Only works on a column that is not in the db
function save_column(req, res){
    const newCol = new Column({
        column_id: req.body.column_id, 
        creator_id: "Anon", 
        formation: req.body.formation, 
        description: req.body.description, 
        search_keys: [],
        lithologies: req.body.lithologies,
    });

    // column needs to be saved first because if it fails, we don't want to save beds
    newCol.save(function(err){
        if(err) {
            console.log(err); 
            res.send({msg:"Failed to save beds"}); // TODO don't currently do anything with this on frontend
            return; 
        ;} // if err, don't save beds.

        beds = []
        for (i=0; i<req.body.beds.length; i++) {
            const b = req.body.beds[i];
            const newBed = new Bed({
                bed_start: b.bed_start, 
                bed_end: b.bed_end, 
                grain_size: b.grain_size, 
                features : b.features, 
                column_id: b.column_id, 
                lithology: b.lithology,
            });
            newBed.save(function(err, bed){
                if(err) console.log(err);
            });
            beds.push(newBed); 
        };

        for (i=0; i<req.body.chem.length; i++) {
            const c = req.body.chem[i]; 
            const newChem = new ChemData({
                column_id: c.column_id, 
                data_type: c.data_type,
                comments: "",
                data: [],
            })
            for (j=0; j<c.data.length; j++){
                newChem.data.push({depth: c.data[j].depth, value: c.data[j].value});
            }
            newChem.save(function(err, chem){
                if (err) console.log(err);
            });
        }
            
        // Computing index using beds that are NOT the saved version of the beds
        // This is ok iff two people are not trying to create a column with the same column_id
        // at the same time. Ok for now at this scale, would need locks / safety at larger scale
        computeIndex(req.body.column_id, beds);
        res.send({msg:"saved column"});
    })
}

module.exports = router;
