'use strict';

const swarm = require('discovery-swarm');
const gossip = require('secure-gossip');
const EventEmitter = require('events');
const ethUtils = require('ethereumjs-utils');

// console-only packages, not for browsers
const fs = require('fs');
const os = require('os');
const path = require('path');

// Common Bucket Tx
const fields = 
[
	{name: 'nonce', length: 32, allowLess: true, default: new Buffer([]) },
	{name: 'originAddress', length: 20, allowZero: true, default: new Buffer([]) },
	{name: 'ipfsHash', length: 32, allowLess: true, default: new Buffer([]) },
	{name: 'since', length: 32, allowLess: true, default: new Buffer([]) },
	{name: 'reply', length: 32, allowLess: true, default: new Buffer([]) },
	{name: 'comment', length: 32, allowLess: true, default: new Buffer([]) },
	{name: 'score', length: 32, allowZero: true, default: new Buffer([]) }, // review only
	{name: 'category', length: 32, allowLess: true, default: new Buffer([]) }, // new fields to be handled by ??? 
   	{name: 'v', allowZero: true, default: new Buffer([0x1c]) },
   	{name: 'r', allowZero: true, length: 32, default: new Buffer([]) },
   	{name: 's', allowZero: true, length: 32, default: new Buffer([]) }
];

// Validator Only
const active =
[
	{name: 'validator', length: 20, allowZero: true, default: new Buffer([]) },
	{name: 'originAddress', length: 20, allowZero: true, default: new Buffer([]) },
	{name: 'ipfsHash', length: 32, allowLess: true, default: new Buffer([]) },
	{name: 'since', length: 32, allowLess: true, default: new Buffer([]) },
	{name: 'agree', length: 32, allowLess: true, default: new Buffer([]) },
	{name: 'disagree', length: 32, allowLess: true, default: new Buffer([]) },
	{name: 'score', length: 32, allowZero: true, default: new Buffer([]) }, // review only
	{name: 'category', length: 32, allowLess: true, default: new Buffer([]) }, // new fields to be handled by ??? 
   	{name: 'v', allowZero: true, default: new Buffer([0x1c]) },
   	{name: 'r', allowZero: true, length: 32, default: new Buffer([]) },
   	{name: 's', allowZero: true, length: 32, default: new Buffer([]) }
];

const summary = 
[
	{name: 'validator', length: 20, allowZero: true, default: new Buffer([]) },
	{name: 'originAddress', length: 20, allowZero: true, default: new Buffer([]) },
	{name: 'start', length: 32, allowLess: true, default: new Buffer([]) },
	{name: 'end', length: 32, allowLess: true, default: new Buffer([]) },
	{name: 'spend', length: 32, allowLess: true, default: new Buffer([]) },
	{name: 'gain', length: 32, allowLess: true, default: new Buffer([]) },
	{name: 'accuRewards', length: 32, allowLess: true, default: new Buffer([]) },
   	{name: 'v', allowZero: true, default: new Buffer([0x1c]) },
   	{name: 'r', allowZero: true, length: 32, default: new Buffer([]) },
   	{name: 's', allowZero: true, length: 32, default: new Buffer([]) }
];

class PubSub extends EventEmitter 
{
	constructor(options) {
		super();

		let opts = { gossip: {}, ...options };
		this.port  = opts.port || 0;
  		this.swarm = swarm(opts);
		this.topicList = [];
		this.firstConn = false;
		this.initialized = false;

		this.join = (topic) =>
		{
  			if (!topic || typeof topic !== 'string') { throw new Error('topic must be set as a string') }
			this.seen  = { init: Math.floor(Date.now()/1000), logs: {}, seen: {} };
			this.topicList.push(topic);
  			return this.swarm.join(topic);
		}

		this.leave = (topic) =>
		{
			if (this.topicList.indexOf(topic) === -1) return true;
			this.topicList.splice(this.topicList.indexOf(topic), 1);
			return this.swarm.leave(topic);
		}

		this.stats = () =>
		{
			return {
				topics: this.topicList,
				peerseen: this.swarm._peersSeen,
				connecting: this.swarm.connecting,
				upcomming: this.swarm.queued,
				connected: this.swarm.connected
			};
		}

		this.connectP2P = () =>
		{
			if (fs.existsSync(path.join(os.homedir(), '.optract_keys'))) {
				let b = fs.readFileSync(path.join(os.homedir(), '.optract_keys'));
				opts.gossip.keys = JSON.parse(b.toString());
				this.gossip = gossip(opts.gossip);
			} else {
				this.gossip = gossip(opts.gossip);
				fs.writeFileSync(path.join(os.homedir(), '.optract_keys'), JSON.stringify(this.gossip.keys))
			}

  			this.id = this.gossip.keys.public; // should eventually use ETH address
			console.log('My ID: ' + this.id);

		  	this.gossip.on('message', (msg) => {
				//console.log('get Message'); console.dir(msg);
				if (this.filterSeen(msg) && this.throttlePeer(msg.data) && this.validateMsg(msg.data) ) {
					this.emit('incomming', msg);
				}
  			})

			// default dummy incomming handler
			this.on('incomming', (msg) => { 
				console.log('message passed filters, incomming event emitted...');
			});

  			this.swarm.on('connection', (connection) => 
			{
    				console.log("\nFound " + this.swarm.connected + ' connected ' + (this.swarm.connected === 1 ? 'peer' : 'peers') );
    				let g = this.gossip.createPeerStream();
    				connection.pipe(g).pipe(connection);

    				if (!this.firstConn && this.swarm.connected === 1) {
      					this.firstConn = true;
      					this.emit('connected');
    				}
  			});

			this.initialized = true;
		}

		// encode if packet is object, decode if it is RLPx
                this.handleRLPx = (fields) => (packet) =>
                {
                        let m = {};
                        try {
                                ethUtils.defineProperties(m, fields, packet);
                                return m;
                        } catch(err) {
                                console.trace(err);
                                return {};
                        }
                }

		this.filterSeen = (msg) =>
		{
			msg = JSON.stringify(msg);
			let timeNow = Math.floor(Date.now()/1000);
			let hashID = ethUtils.bufferToHex(ethUtils.sha256(Buffer.from(msg)));
			if (typeof(this.seen.logs[hashID]) !== 'undefined' && timeNow - this.seen.logs[hashID] < 10000 ) {
				this.seen.logs[hashID] = timeNow;
				return false;
			} else {
				Object.keys(this.seen.logs).map((h) => { if (timeNow - this.seen.logs[h] > 25000) delete this.seen.logs[h]; });
				this.seen.logs[hashID] = timeNow;
				return true;
			}
		}

		this.throttlePeer = (info) =>
		{
			try {
				let timeNow = Math.floor(Date.now()/1000);
				if (typeof(this.seen.seen[info.public]) !== 'undefined' && timeNow - this.seen.seen[info.public] < 3) {
					this.seen.seen[info.public] = timeNow;
					return false;
				} else {
					Object.keys(this.seen.seen).map((h) => { if (timeNow - this.seen.seen[h] > 25000) delete this.seen.seen[h]; });
					this.seen.seen[info.public] = timeNow;
					return true;
				}
			} catch (err) {
				console.trace(err); return false;
			}
		}

		this.validateMsg = (msg) =>
		{
			// - msg requires to contain "topic"
			if (typeof(msg.topic) === 'undefined') return false;
			// - topic needs to be in this.topicList
			if (this.topicList.length === 0 || this.topicList.indexOf(msg.topic) === -1) return false;

			// TODO: things to check
			// - based on topic, msg should be specific encoded RLPx
			// - all necessary RLP field tests
			// - signature matches
			return true; // place holder
		}

		this.publish = (topic, msg) =>
		{
			if (this.topicList.length === 0 || this.topicList.indexOf(topic) === -1) return false; 
			msg = { data: {topic, msg, public: this.id} }; // secure-gossip requires the key named "data" ...
    			return this.gossip.publish(msg)
		}

		this.setIncommingHandler = (func) => // func needs to take one args, which is msg object
		{
			if (typeof(func) !== 'function') { return false; }
			this.removeAllListeners('incomming');
			this.on('incomming', func);
			return true;
		}

  		this.swarm.listen(this.port);
	}
}

module.exports = PubSub;
