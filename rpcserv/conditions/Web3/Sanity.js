module.exports =
{
	Web3_sendTransaction_sanity(addr, jobObj) 
	{
		let gasCost = this.gasCostEst(addr, jobObj.txObj);

		if (
			jobObj.txObj.to != this.web3.toAddress('0x0')
		     && this.web3.toBigNumber(jobObj.txObj.value).gte(0)
		     && this.web3.eth.getBalance(addr).gte(gasCost)
		) {
			return true;
		} else {
			console.log( `WARNING: transaction not send from ${addr}` );
			return false;
		} 	
	}
}
